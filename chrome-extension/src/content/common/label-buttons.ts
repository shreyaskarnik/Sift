import { MSG } from "../../shared/constants";
import type { TrainingLabel } from "../../shared/types";

export function createLabelButtons(
  text: string,
  source: "hn" | "reddit" | "x",
): HTMLSpanElement {
  const container = document.createElement("span");
  container.className = "ss-votes";

  const btnUp = document.createElement("span");
  btnUp.className = "ss-vote ss-vote-up";
  btnUp.textContent = "\u{1F44D}";
  btnUp.title = "Matches your vibe";

  const btnDown = document.createElement("span");
  btnDown.className = "ss-vote ss-vote-down";
  btnDown.textContent = "\u{1F44E}";
  btnDown.title = "Doesn't match your vibe";

  let selected: "positive" | "negative" | null = null;

  function handleClick(label: "positive" | "negative", btn: HTMLSpanElement) {
    if (selected === label) return;
    selected = label;

    const isUp = label === "positive";
    btnUp.classList.toggle("ss-on", isUp);
    btnUp.classList.toggle("ss-off", !isUp);
    btnDown.classList.toggle("ss-on", !isUp);
    btnDown.classList.toggle("ss-off", isUp);

    // Trigger pop animation on the selected button
    btn.classList.remove("ss-pop");
    // Force reflow so re-adding the class restarts the animation
    void btn.offsetWidth;
    btn.classList.add("ss-pop");

    const trainingLabel: TrainingLabel = {
      text,
      label,
      source,
      timestamp: Date.now(),
    };

    chrome.runtime.sendMessage({
      type: MSG.SAVE_LABEL,
      payload: { label: trainingLabel },
    });
  }

  btnUp.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleClick("positive", btnUp);
  });

  btnDown.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleClick("negative", btnDown);
  });

  container.append(btnUp, btnDown);
  return container;
}
