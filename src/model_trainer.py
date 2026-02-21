from huggingface_hub import login, HfApi, model_info, metadata_update
from sentence_transformers import SentenceTransformer, util
from datasets import Dataset
from sentence_transformers import SentenceTransformerTrainer, SentenceTransformerTrainingArguments
from sentence_transformers.losses import MultipleNegativesRankingLoss
from transformers import TrainerCallback
from typing import List, Optional
from dataclasses import dataclass, field
from collections import defaultdict
from pathlib import Path
import random

# --- Held-Out Evaluation Data ---

@dataclass
class HeldOutItem:
    text: str
    is_positive: bool
    baseline_score: float = 0.0

@dataclass
class AnchorHeldOutGroup:
    anchor: str
    items: list[HeldOutItem] = field(default_factory=list)


def _normalize_text(text: str) -> str:
    """Lowercase + collapse whitespace for near-duplicate detection."""
    return " ".join(text.lower().split())


def split_held_out(
    triplets: list[list[str]],
    fraction: float = 0.15,
    min_anchor_triplets: int = 4,
    seed: int = 42,
) -> tuple[list[list[str]], list[AnchorHeldOutGroup]]:
    """Split triplets into train set and per-anchor held-out groups.

    Anchors with fewer than min_anchor_triplets go entirely to training.
    Near-duplicate texts (by normalized form) are excluded from held-out
    if they also appear in training, preventing data leakage.
    Returns (train_triplets, held_out_groups).
    """
    if fraction == 0:
        return list(triplets), []

    rng = random.Random(seed)

    by_anchor: dict[str, list[list[str]]] = defaultdict(list)
    for t in triplets:
        by_anchor[t[0]].append(t)

    train_triplets: list[list[str]] = []
    held_out_groups: list[AnchorHeldOutGroup] = []

    for anchor, rows in by_anchor.items():
        if len(rows) < min_anchor_triplets:
            train_triplets.extend(rows)
            continue

        shuffled = rows[:]
        rng.shuffle(shuffled)
        n_held = max(1, round(len(rows) * fraction))
        held_rows = shuffled[:n_held]
        train_part = shuffled[n_held:]
        train_triplets.extend(train_part)

        # Normalized train texts for leakage check
        train_norms: set[str] = set()
        for row in train_part:
            train_norms.add(_normalize_text(row[1]))
            train_norms.add(_normalize_text(row[2]))

        # Collect unique held-out texts, excluding near-duplicates of train texts
        seen_norm: set[str] = set()
        items: list[HeldOutItem] = []
        for row in held_rows:
            for text, is_pos in [(row[1], True), (row[2], False)]:
                norm = _normalize_text(text)
                if norm not in seen_norm and norm not in train_norms:
                    seen_norm.add(norm)
                    items.append(HeldOutItem(text=text, is_positive=is_pos))

        if items:
            held_out_groups.append(AnchorHeldOutGroup(anchor=anchor, items=items))

    return train_triplets, held_out_groups


# --- Held-Out Scoring & Formatting ---

def score_held_out_items(
    model: SentenceTransformer,
    groups: list[AnchorHeldOutGroup],
    task_name: str,
) -> dict[str, list[float]]:
    """Score each held-out item against its anchor. Returns {anchor: [scores]}."""
    results: dict[str, list[float]] = {}
    for g in groups:
        anchor_emb = model.encode(g.anchor, prompt_name=task_name)
        texts = [item.text for item in g.items]
        text_embs = model.encode(texts, prompt_name=task_name)
        sims = util.cos_sim(anchor_emb, text_embs)[0].tolist()
        results[g.anchor] = sims
    return results


def format_taste_table(
    groups: list[AnchorHeldOutGroup],
    scores: dict[str, list[float]],
    header: str,
    show_baseline_delta: bool = False,
) -> str:
    """Format a per-epoch taste table with optional delta from baseline."""
    lines = [f"\n=== Taste Check ({header}) {'=' * max(1, 45 - len(header))}"]
    for g in groups:
        s = scores[g.anchor]
        lines.append(f"\nAnchor: {g.anchor} ({len(g.items)} items)")
        pos_scores, neg_scores = [], []
        for item, score in zip(g.items, s):
            tag = "+" if item.is_positive else "-"
            label = item.text[:50]
            delta_str = ""
            if show_baseline_delta:
                delta = score - item.baseline_score
                delta_str = f"  ({delta:+.2f})"
            lines.append(f"  {tag} \"{label}\"{' ' * max(1, 55 - len(label))}{score:.2f}{delta_str}")
            (pos_scores if item.is_positive else neg_scores).append(score)

        avg_p = sum(pos_scores) / len(pos_scores) if pos_scores else 0
        avg_n = sum(neg_scores) / len(neg_scores) if neg_scores else 0
        gap = avg_p - avg_n
        n_pairs = len(pos_scores) * len(neg_scores)
        n_correct = sum(1 for ps in pos_scores for ns in neg_scores if ps > ns)
        pair_pct = (n_correct / n_pairs * 100) if n_pairs else 0
        gap_str = f"  gap: {gap:.2f}"
        pair_str = f"  pos>neg: {pair_pct:.0f}%"
        if show_baseline_delta:
            bp = [it.baseline_score for it in g.items if it.is_positive]
            bn = [it.baseline_score for it in g.items if not it.is_positive]
            old_gap = (sum(bp) / len(bp) if bp else 0) - (sum(bn) / len(bn) if bn else 0)
            gap_str += f"  (was {old_gap:.2f})"
            base_correct = sum(1 for ps in bp for ns in bn if ps > ns)
            base_pairs = len(bp) * len(bn)
            base_pct = (base_correct / base_pairs * 100) if base_pairs else 0
            pair_str += f" (was {base_pct:.0f}%)"
        lines.append(f"  avg +: {avg_p:.2f}  avg -: {avg_n:.2f}{gap_str}{pair_str}")
    return "\n".join(lines)


def format_taste_final(
    groups: list[AnchorHeldOutGroup],
    final_scores: dict[str, list[float]],
) -> str:
    """Format the before→after final summary."""
    lines = [f"\n=== Taste Check -- Final {'=' * 30}"]
    for g in groups:
        s = final_scores[g.anchor]
        lines.append(f"\nAnchor: {g.anchor}")
        lines.append(f"  {'':55s} Before -> After")
        pos_before, pos_after, neg_before, neg_after = [], [], [], []
        for item, score in zip(g.items, s):
            tag = "+" if item.is_positive else "-"
            label = item.text[:50]
            delta = score - item.baseline_score
            lines.append(
                f"  {tag} \"{label}\"{' ' * max(1, 55 - len(label))}"
                f"{item.baseline_score:.2f}  ->  {score:.2f}  ({delta:+.2f})"
            )
            if item.is_positive:
                pos_before.append(item.baseline_score)
                pos_after.append(score)
            else:
                neg_before.append(item.baseline_score)
                neg_after.append(score)

        avg_pb = sum(pos_before) / len(pos_before) if pos_before else 0
        avg_pa = sum(pos_after) / len(pos_after) if pos_after else 0
        avg_nb = sum(neg_before) / len(neg_before) if neg_before else 0
        avg_na = sum(neg_after) / len(neg_after) if neg_after else 0
        gap_b = avg_pb - avg_nb
        gap_a = avg_pa - avg_na
        n_pairs = len(pos_before) * len(neg_before)
        pct_b = (sum(1 for p in pos_before for n in neg_before if p > n) / n_pairs * 100) if n_pairs else 0
        pct_a = (sum(1 for p in pos_after for n in neg_after if p > n) / n_pairs * 100) if n_pairs else 0
        lines.append(
            f"  avg +: {avg_pb:.2f} -> {avg_pa:.2f}  "
            f"avg -: {avg_nb:.2f} -> {avg_na:.2f}  "
            f"gap: {gap_b:.2f} -> {gap_a:.2f}  "
            f"pos>neg: {pct_b:.0f}% -> {pct_a:.0f}%"
        )
    return "\n".join(lines)


# --- Model/Utility Functions ---

def authenticate_hf(token: Optional[str]) -> None:
    """Logs into the Hugging Face Hub."""
    if token:
        print("Logging into Hugging Face Hub...")
        login(token=token)
    else:
        print("Skipping Hugging Face login: HF_TOKEN not set.")

def load_embedding_model(model_name: str) -> SentenceTransformer:
    """Initializes the Sentence Transformer model."""
    print(f"Loading Sentence Transformer model: {model_name}")
    try:
        model = SentenceTransformer(model_name, model_kwargs={"device_map": "auto"})
        print(f"Model loaded successfully. {model.device}")
        return model
    except Exception as e:
        print(f"Error loading Sentence Transformer model {model_name}: {e}")
        raise

def get_top_hits(
    model: SentenceTransformer,
    target_titles: List[str],
    task_name: str,
    query: str = "MY_FAVORITE_NEWS",
    top_k: int = 5
) -> str:
    """Performs semantic search on target_titles and returns a formatted result string."""
    if not target_titles:
        return "No target titles available for search."

    # Encode the query
    query_embedding = model.encode(query, prompt_name=task_name)

    # Encode the target titles (only done once per call)
    title_embeddings = model.encode(target_titles, prompt_name=task_name)

    # Perform semantic search
    top_hits = util.semantic_search(query_embedding, title_embeddings, top_k=top_k)[0]

    result = []
    for hit in top_hits:
        title = target_titles[hit['corpus_id']]
        score = hit['score']
        result.append(f"[{title}] {score:.4f}")

    return "\n".join(result)

def upload_model_to_hub(folder_path: Path, repo_name: str, token: str) -> str:
    """
    Uploads a local model folder to the Hugging Face Hub.
    Creates the repository if it doesn't exist.

    repo_name accepts either:
    - "model-name" (auto-prefixed with authenticated username)
    - "owner/model-name" (used as-is)
    """
    try:
        api = HfApi(token=token)

        requested = repo_name.strip().strip("/")
        if not requested:
            raise ValueError("Repository name cannot be empty.")
        if requested.count("/") > 1:
            raise ValueError(
                f"Invalid repo name '{repo_name}'. Use 'model-name' or 'owner/model-name'."
            )

        # If owner is provided, use directly. Otherwise prefix with authenticated username.
        if "/" in requested:
            repo_id = requested
        else:
            user_info = api.whoami()
            username = user_info["name"]
            repo_id = f"{username}/{requested}"

        print(f"Preparing to upload to: {repo_id}")

        # Create the repo (safe if it already exists)
        api.create_repo(repo_id=repo_id, exist_ok=True)
        
        # Upload the folder
        url = api.upload_folder(
            folder_path=folder_path,
            repo_id=repo_id,
            repo_type="model"
        )
        
        info = model_info(
            repo_id=repo_id,
            token=token
        )
        tags = list((info.card_data.tags if info.card_data else []) or [])
        if "embeddinggemma-tuning-lab" not in tags:
            tags.append("embeddinggemma-tuning-lab")
            metadata_update(
                repo_id=repo_id,
                metadata={"tags": tags},
                overwrite=True,
                token=token,
            )
        
        return f"✅ Success! Model published at: {url}"
    except Exception as e:
        print(f"Upload failed: {e}")
        return f"❌ Upload failed: {str(e)}"

# --- Training Class and Function ---

class TasteTracker(TrainerCallback):
    """Scores held-out items at baseline and each epoch to track taste alignment."""

    def __init__(
        self,
        model: SentenceTransformer,
        groups: list[AnchorHeldOutGroup],
        task_name: str,
    ):
        self.model = model
        self.groups = groups
        self.task_name = task_name
        self.final_scores: dict[str, list[float]] = {}

    def on_train_begin(self, args, state, control, **kwargs):
        scores = score_held_out_items(self.model, self.groups, self.task_name)
        for g in self.groups:
            for item, s in zip(g.items, scores[g.anchor]):
                item.baseline_score = s
        if state.is_world_process_zero:
            print(format_taste_table(self.groups, scores, "baseline"))

    def on_epoch_end(self, args, state, control, **kwargs):
        epoch = int(state.epoch)
        scores = score_held_out_items(self.model, self.groups, self.task_name)
        self.final_scores = scores
        if state.is_world_process_zero:
            print(format_taste_table(self.groups, scores, f"epoch {epoch}", show_baseline_delta=True))

    def get_final_summary(self) -> str:
        if not self.final_scores:
            return ""
        return format_taste_final(self.groups, self.final_scores)


def train_with_dataset(
    model: SentenceTransformer,
    train_triplets: List[List[str]],
    output_dir: Path,
    task_name: str,
    held_out_groups: Optional[list[AnchorHeldOutGroup]] = None,
    epochs: int = 4,
    learning_rate: float = 2e-5,
) -> Optional["TasteTracker"]:
    """Fine-tunes the model on train_triplets.

    Returns TasteTracker if held_out_groups were provided (use get_final_summary()).
    """
    data_as_dicts = [
        {"anchor": row[0], "positive": row[1], "negative": row[2]}
        for row in train_triplets
    ]

    train_dataset = Dataset.from_list(data_as_dicts)
    loss = MultipleNegativesRankingLoss(model)

    prompts = getattr(model, 'prompts', {}).get(task_name)
    if not prompts:
        print(f"Warning: Could not find prompts for task '{task_name}' in model. Training may be less effective.")
        prompts = []

    callbacks = []
    taste_tracker = None
    if held_out_groups:
        taste_tracker = TasteTracker(model, held_out_groups, task_name)
        callbacks.append(taste_tracker)

    args = SentenceTransformerTrainingArguments(
        output_dir=output_dir,
        prompts=prompts,
        num_train_epochs=epochs,
        per_device_train_batch_size=1,
        learning_rate=learning_rate,
        warmup_ratio=0.1,
        logging_steps=train_dataset.num_rows,
        report_to="none",
        save_strategy="no",
    )

    trainer = SentenceTransformerTrainer(
        model=model,
        args=args,
        train_dataset=train_dataset,
        loss=loss,
        callbacks=callbacks,
    )

    trainer.train()

    print("Training finished. Model weights are updated in memory.")
    trainer.save_model()
    print(f"Model saved locally to: {output_dir}")

    return taste_tracker
