import spaces
from huggingface_hub import login
from sentence_transformers import SentenceTransformer, util
from datasets import Dataset
from sentence_transformers import SentenceTransformerTrainer, SentenceTransformerTrainingArguments
from sentence_transformers.losses import MultipleNegativesRankingLoss
from transformers import TrainerCallback, TrainingArguments
from typing import List, Callable, Optional
from pathlib import Path

# --- Model/Utility Functions ---

def authenticate_hf(token: Optional[str]) -> None:
    """Logs into the Hugging Face Hub."""
    if token:
        print("Logging into Hugging Face Hub...")
        login(token=token)
    else:
        print("Skipping Hugging Face login: HF_TOKEN not set.")

@spaces.GPU
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

# --- Training Class and Function ---

class EvaluationCallback(TrainerCallback):
    """
    A callback that runs the semantic search evaluation at the end of each log step.
    The search function is passed in during initialization.
    """
    def __init__(self, search_fn: Callable[[], str]):
        self.search_fn = search_fn

    def on_log(self, args: TrainingArguments, state, control, **kwargs):
        print(f"Step {state.global_step} finished. Running evaluation:")
        print(f"\n{self.search_fn()}\n")


@spaces.GPU
def train_with_dataset(
    model: SentenceTransformer,
    dataset: List[List[str]],
    output_dir: Path,
    task_name: str,
    search_fn: Callable[[], str]
) -> None:
    """
    Fine-tunes the provided Sentence Transformer MODEL on the dataset.

    The dataset should be a list of lists: [[anchor, positive, negative], ...].
    """
    # Convert to Hugging Face Dataset format
    data_as_dicts = [
        {"anchor": row[0], "positive": row[1], "negative": row[2]}
        for row in dataset
    ]

    train_dataset = Dataset.from_list(data_as_dicts)

    # Use MultipleNegativesRankingLoss, suitable for contrastive learning
    loss = MultipleNegativesRankingLoss(model)

    # Note: SentenceTransformer models typically have a 'prompts' attribute
    # which we need to access for the training arguments.
    prompts = getattr(model, 'prompts', {}).get(task_name)
    if not prompts:
        print(f"Warning: Could not find prompts for task '{task_name}' in model. Training may be less effective.")
        # Fallback to an empty list or appropriate default if required by the model's structure
        prompts = [] 

    args = SentenceTransformerTrainingArguments(
        output_dir=output_dir,
        prompts=prompts,
        num_train_epochs=4,
        per_device_train_batch_size=1,
        learning_rate=2e-5,
        warmup_ratio=0.1,
        logging_steps=train_dataset.num_rows,
        report_to="none",
        save_strategy="no" # No saving during training, only at the end
    )

    trainer = SentenceTransformerTrainer(
        model=model,
        args=args,
        train_dataset=train_dataset,
        loss=loss,
        callbacks=[EvaluationCallback(search_fn)]
    )

    trainer.train()

    print("Training finished. Model weights are updated in memory.")

    # Save the final fine-tuned model
    trainer.save_model()

    print(f"Model saved locally to: {output_dir}")
