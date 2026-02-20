#!/usr/bin/env python3
"""
Fine-tune EmbeddingGemma on Sift CSV training data, then convert to ONNX.

Usage:
  python train.py path/to/sift_training.csv
  python train.py path/to/sift_training.csv --epochs 6 --lr 3e-5
  python train.py --convert-only path/to/saved_model
  python train.py --serve path/to/onnx_model
"""
import csv
import sys
import argparse
from pathlib import Path

from sentence_transformers import SentenceTransformer
from src.model_trainer import train_with_dataset, get_top_hits, upload_model_to_hub
from src.config import AppConfig


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------

def load_csv(path: str) -> list[list[str]]:
    """Load Anchor,Positive,Negative triplets from CSV."""
    triplets = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)

        try:
            first_row = next(reader)
        except StopIteration:
            return triplets

        def maybe_append_triplet(row: list[str]) -> None:
            if len(row) < 3:
                return
            anchor = row[0].strip()
            positive = row[1].strip()
            negative = row[2].strip()
            if anchor and positive and negative:
                triplets.append([anchor, positive, negative])

        is_header = (
            len(first_row) >= 3
            and first_row[0].strip().lower() == "anchor"
            and first_row[1].strip().lower() == "positive"
            and first_row[2].strip().lower() == "negative"
        )
        if not is_header:
            maybe_append_triplet(first_row)

        for row in reader:
            maybe_append_triplet(row)
    return triplets


# ---------------------------------------------------------------------------
# Full-pipeline ONNX export
# ---------------------------------------------------------------------------

def convert_to_onnx(model_dir: Path, output_dir: Path, quantize: bool = True) -> Path:
    """
    Convert a SentenceTransformer checkpoint to ONNX for Transformers.js.

    Uses optimum's exporter with library_name='sentence_transformers' to produce
    a single ONNX graph containing the full pipeline (Transformer → MeanPooling →
    Dense → Dense → Normalize) with 'sentence_embedding' output.

    Produces (matching onnx-community layout for Transformers.js):
      output_dir/
        config.json, tokenizer.json, tokenizer_config.json, special_tokens_map.json
        onnx/
          model.onnx           (fp32)
          model_quantized.onnx  (int8)
          model_q4.onnx         (4-bit block-quantized)
    """
    import shutil
    from optimum.exporters.onnx import main_export

    print("\n--- ONNX Conversion ---")
    print(f"Exporting {model_dir} → {output_dir}...")

    main_export(
        model_name_or_path=str(model_dir),
        output=output_dir,
        task="feature-extraction",
        device="cpu",
        library_name="sentence_transformers",
        do_validation=False,
    )

    # optimum puts model.onnx at root; Transformers.js expects onnx/ subdirectory
    onnx_subdir = output_dir / "onnx"
    onnx_subdir.mkdir(exist_ok=True)
    root_onnx = output_dir / "model.onnx"
    onnx_path = onnx_subdir / "model.onnx"
    if root_onnx.exists():
        shutil.move(str(root_onnx), str(onnx_path))

    size_mb = onnx_path.stat().st_size / (1024 * 1024)
    print(f"ONNX model (fp32): {size_mb:.1f} MB")

    if quantize:
        import logging
        logging.disable(logging.INFO)

        # INT8 dynamic quantization
        try:
            from onnxruntime.quantization import quantize_dynamic, QuantType

            quant_path = onnx_subdir / "model_quantized.onnx"
            print("Quantizing to INT8...")
            quantize_dynamic(str(onnx_path), str(quant_path), weight_type=QuantType.QInt8)
            print(f"INT8 model: {quant_path.stat().st_size / (1024*1024):.1f} MB")
        except Exception as e:
            print(f"INT8 quantization failed (non-critical): {e}")

        # 4-bit block quantization (for WebGPU inference)
        try:
            import onnx
            from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

            print("Quantizing to Q4...")
            model_proto = onnx.load(str(onnx_path))
            quant = MatMulNBitsQuantizer(
                model_proto, block_size=32, is_symmetric=True, accuracy_level=4,
            )
            quant.process()
            q4_path = onnx_subdir / "model_q4.onnx"
            onnx.save(quant.model.model, str(q4_path))
            print(f"Q4 model: {q4_path.stat().st_size / (1024*1024):.1f} MB")
        except Exception as e:
            print(f"Q4 quantization failed (non-critical): {e}")

        logging.disable(logging.NOTSET)

    print(f"\nTransformers.js model ready at: {output_dir}")
    return output_dir


# ---------------------------------------------------------------------------
# Local model server
# ---------------------------------------------------------------------------

def serve_model(model_dir: Path, port: int = 8000):
    """Serve model files locally with CORS, compatible with Transformers.js.

    Transformers.js fetches: {host}/{model}/resolve/{revision}/{filename}
    This server strips the HF path prefix and serves files from model_dir.
    Extension should set env.remoteHost = "http://localhost:8000"
    and use model_id = "local".
    """
    import http.server

    model_dir_abs = str(model_dir.resolve())

    class CORSHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=model_dir_abs, **kwargs)

        def translate_path(self, path):
            # Strip HF-style prefix: /{model}/resolve/{revision}/{filename} → /{filename}
            parts = path.split("/")
            if "resolve" in parts:
                idx = parts.index("resolve")
                path = "/" + "/".join(parts[idx + 2:])
            return super().translate_path(path)

        def end_headers(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET")
            self.send_header("Access-Control-Allow-Headers", "*")
            super().end_headers()

        def do_OPTIONS(self):
            self.send_response(200)
            self.end_headers()

    print(f"Serving model from {model_dir} on http://localhost:{port}")
    print(f"Extension: set Custom Model URL to http://localhost:{port}")
    print("Press Ctrl+C to stop\n")
    server = http.server.HTTPServer(("localhost", port), CORSHandler)
    server.serve_forever()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Fine-tune EmbeddingGemma + convert to ONNX")
    parser.add_argument("csv_path", nargs="?", help="Path to Sift training CSV")
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--push-to-hub", type=str, default=None)
    parser.add_argument("--no-quantize", action="store_true")
    parser.add_argument("--convert-only", type=str, default=None,
                        help="Skip training, convert existing model to ONNX")
    parser.add_argument("--serve", type=str, default=None,
                        help="Serve a converted model dir locally for testing")
    parser.add_argument("--port", type=int, default=8000,
                        help="Port for --serve (default: 8000)")
    args = parser.parse_args()

    if args.epochs <= 0:
        parser.error("--epochs must be >= 1")
    if args.lr <= 0:
        parser.error("--lr must be > 0")

    # --- Serve mode ---
    if args.serve:
        serve_model(Path(args.serve), port=args.port)
        return

    # --- Convert-only mode ---
    if args.convert_only:
        model_dir = Path(args.convert_only)
        onnx_dir = model_dir.parent / f"{model_dir.name}_onnx_transformersjs"
        convert_to_onnx(model_dir, onnx_dir, quantize=not args.no_quantize)
        print(f"\nTo test locally:\n  python train.py --serve {onnx_dir}")
        return

    # --- Full train + convert ---
    if not args.csv_path:
        parser.print_help()
        sys.exit(1)

    triplets = load_csv(args.csv_path)
    print(f"Loaded {len(triplets)} training triplets from {args.csv_path}")
    if len(triplets) < 2:
        print(
            "Need at least 2 valid triplets (Anchor,Positive,Negative with non-empty values). "
            "Collect more labels!"
        )
        sys.exit(1)

    print(f"Loading base model: {AppConfig.MODEL_NAME}")
    model = SentenceTransformer(AppConfig.MODEL_NAME, model_kwargs={"device_map": "auto"})
    print(f"Model loaded on {model.device}")

    output_dir = Path(args.output) if args.output else AppConfig.ARTIFACTS_DIR / "sift-finetuned"
    output_dir.mkdir(parents=True, exist_ok=True)

    all_titles = list(set([t[1] for t in triplets] + [t[2] for t in triplets]))

    def search_fn():
        return get_top_hits(model, all_titles, AppConfig.TASK_NAME, AppConfig.QUERY_ANCHOR, top_k=5)

    print(f"\n--- Before training ---")
    print(search_fn())

    print(f"\nTraining with epochs={args.epochs}, lr={args.lr}...")
    train_with_dataset(
        model,
        triplets,
        output_dir,
        AppConfig.TASK_NAME,
        search_fn,
        epochs=args.epochs,
        learning_rate=args.lr,
    )

    print(f"\n--- After training ---")
    print(search_fn())
    print(f"\nPyTorch model saved to: {output_dir}")

    # Convert to ONNX
    onnx_output = output_dir.parent / f"{output_dir.name}_onnx_transformersjs"
    convert_to_onnx(output_dir, onnx_output, quantize=not args.no_quantize)

    if args.push_to_hub:
        token = AppConfig.HF_TOKEN
        if not token:
            print("Set HF_TOKEN to push to Hub")
            sys.exit(1)
        result = upload_model_to_hub(output_dir, args.push_to_hub, token)
        print(result)

    print(f"\nTo test locally:\n  python train.py --serve {onnx_output}")
    print(
        "\nNote: ONNX model files contain only numerical weights and tokenizer"
        "\ndata — no training examples or personal information. They are safe"
        "\nto publish publicly on HuggingFace Hub for use with the extension."
    )


if __name__ == "__main__":
    main()
