# /// script
# requires-python = ">=3.11"
# dependencies = ["sentence-transformers", "numpy", "torch"]
# ///
"""
Validate zero-shot embedding quality of candidate category anchor texts.

Computes pairwise cosine similarity to find categories that are too close
(would be confusing as separate options) or natural clusters to merge.
"""

import numpy as np
from sentence_transformers import SentenceTransformer, util

MODEL_NAME = "google/embeddinggemma-300m"
TASK_NAME = "Classification"

# Current 5 presets
CURRENT = [
    "MY_FAVORITE_NEWS",
    "AI_RESEARCH",
    "STARTUP_NEWS",
    "DEEP_TECH",
    "SCIENCE_DISCOVERIES",
]

# Candidate additions for Phase 1 curated library
CANDIDATES = [
    "FINANCE_MARKETS",
    "CRYPTO_WEB3",
    "PROGRAMMING_DEV_TOOLS",
    "DESIGN_UX",
    "HEALTH_BIOTECH",
    "CLIMATE_ENERGY",
    "GAMING",
    "SPORTS",
    "POLITICS",
    "CULTURE_ARTS",
    "EDUCATION",
    "OPEN_SOURCE",
    "PRODUCT_SAAS",
    "SECURITY_PRIVACY",
    "SPACE_AEROSPACE",
    "FOOD_COOKING",
    "PARENTING",
    "TRAVEL",
    "LEGAL_POLICY",
    "MUSIC",
]

SIMILARITY_WARN_THRESHOLD = 0.85  # pairs above this are suspiciously close


def main():
    all_categories = CURRENT + CANDIDATES
    print(f"Loading {MODEL_NAME}...")
    model = SentenceTransformer(MODEL_NAME, model_kwargs={"device_map": "auto"})

    print(f"Embedding {len(all_categories)} category anchor texts...")
    embeddings = model.encode(all_categories, prompt_name=TASK_NAME, normalize_embeddings=True)

    # Pairwise cosine similarity
    sim_matrix = util.cos_sim(embeddings, embeddings).numpy()

    # Find close pairs
    close_pairs = []
    for i in range(len(all_categories)):
        for j in range(i + 1, len(all_categories)):
            sim = sim_matrix[i][j]
            if sim >= SIMILARITY_WARN_THRESHOLD:
                close_pairs.append((all_categories[i], all_categories[j], sim))

    close_pairs.sort(key=lambda x: x[2], reverse=True)

    # Print full similarity matrix (top triangle)
    print(f"\n{'='*80}")
    print("PAIRWISE COSINE SIMILARITY (sorted by similarity)")
    print(f"{'='*80}")

    all_pairs = []
    for i in range(len(all_categories)):
        for j in range(i + 1, len(all_categories)):
            all_pairs.append((all_categories[i], all_categories[j], sim_matrix[i][j]))
    all_pairs.sort(key=lambda x: x[2], reverse=True)

    # Show top 25 most similar pairs
    print(f"\nTop 25 most similar pairs:")
    print(f"{'Category A':<25} {'Category B':<25} {'Similarity':>10}")
    print(f"{'-'*25} {'-'*25} {'-'*10}")
    for a, b, sim in all_pairs[:25]:
        flag = " ⚠️" if sim >= SIMILARITY_WARN_THRESHOLD else ""
        print(f"{a:<25} {b:<25} {sim:>10.4f}{flag}")

    # Show bottom 10 least similar pairs
    print(f"\nBottom 10 least similar pairs:")
    print(f"{'Category A':<25} {'Category B':<25} {'Similarity':>10}")
    print(f"{'-'*25} {'-'*25} {'-'*10}")
    for a, b, sim in all_pairs[-10:]:
        print(f"{a:<25} {b:<25} {sim:>10.4f}")

    # Per-category: average similarity to all others (lower = more distinct)
    print(f"\n{'='*80}")
    print("PER-CATEGORY DISTINCTIVENESS (avg similarity to all others — lower = more distinct)")
    print(f"{'='*80}")
    avg_sims = []
    for i, cat in enumerate(all_categories):
        others = [sim_matrix[i][j] for j in range(len(all_categories)) if j != i]
        avg_sims.append((cat, np.mean(others)))
    avg_sims.sort(key=lambda x: x[1])

    print(f"\n{'Category':<25} {'Avg Similarity':>14}  {'Assessment'}")
    print(f"{'-'*25} {'-'*14}  {'-'*20}")
    for cat, avg in avg_sims:
        tag = "current" if cat in CURRENT else "candidate"
        if avg > 0.82:
            assessment = "⚠️  overlaps with others"
        elif avg > 0.75:
            assessment = "moderate"
        else:
            assessment = "distinct"
        print(f"{cat:<25} {avg:>14.4f}  {assessment} [{tag}]")

    # Summary
    if close_pairs:
        print(f"\n{'='*80}")
        print(f"⚠️  WARNING: {len(close_pairs)} pair(s) above {SIMILARITY_WARN_THRESHOLD} threshold:")
        for a, b, sim in close_pairs:
            print(f"  {a} ↔ {b}: {sim:.4f}")
        print("Consider merging these or picking one over the other.")
    else:
        print(f"\n✓ No pairs above {SIMILARITY_WARN_THRESHOLD} threshold — all categories are sufficiently distinct.")


if __name__ == "__main__":
    main()
