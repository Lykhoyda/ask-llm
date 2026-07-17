<template>
  <div class="issue-card" @click="openModal">
    <div class="issue-header">
      <h3>{{ title }}</h3>
      <span class="expand-hint">Click to see solution</span>
    </div>
    <div class="issue-preview">
      {{ preview }}
    </div>
  </div>

  <div v-if="isOpen" class="issue-modal" @click="closeModal">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <div class="modal-title">
          <span class="problem-badge">Problem</span>
          <h2>{{ title }}</h2>
        </div>
        <button @click="closeModal" class="close-btn" title="Close">
          &times;
        </button>
      </div>

      <div class="modal-body">
        <div class="solution-section">
          <h3 class="solution-title">
            <span class="solution-badge">Solution</span>
          </h3>
          <div class="solution-content">
            <slot />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from "vue";

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  preview: {
    type: String,
    required: true,
  },
});

const isOpen = ref(false);

const openModal = async () => {
  isOpen.value = true;
  document.body.style.overflow = "hidden";
  await nextTick();
  setTimeout(addCopyButtons, 100);
};

const closeModal = () => {
  isOpen.value = false;
  document.body.style.overflow = "";
};

const createCopyIcon = () => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");

  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", "9");
  rect.setAttribute("y", "9");
  rect.setAttribute("width", "13");
  rect.setAttribute("height", "13");
  rect.setAttribute("rx", "2");
  rect.setAttribute("ry", "2");

  const path = document.createElementNS(ns, "path");
  path.setAttribute(
    "d",
    "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  );

  svg.appendChild(rect);
  svg.appendChild(path);
  return svg;
};

const createCheckIcon = () => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");

  const polyline = document.createElementNS(ns, "polyline");
  polyline.setAttribute("points", "20,6 9,17 4,12");

  svg.appendChild(polyline);
  return svg;
};

const addCopyButtons = () => {
  const modal = document.querySelector(".issue-modal");
  if (!modal) return;

  const codeBlocks = modal.querySelectorAll("pre, code");

  codeBlocks.forEach((block) => {
    if (block.tagName === "CODE" && block.parentElement.tagName !== "PRE") {
      return;
    }

    if (
      block.querySelector(".copy-btn") ||
      block.parentElement?.querySelector(".copy-btn")
    )
      return;

    const targetElement = block.tagName === "PRE" ? block : block.parentElement;
    if (!targetElement) return;

    const copyButton = document.createElement("button");
    copyButton.className = "copy-btn";
    copyButton.title = "Copy code";
    copyButton.type = "button";
    copyButton.appendChild(createCopyIcon());

    copyButton.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const codeElement = targetElement.querySelector("code") || targetElement;
      if (!codeElement) return;

      const textToCopy = (
        codeElement.textContent ||
        codeElement.innerText ||
        ""
      ).trim();

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          const textArea = document.createElement("textarea");
          textArea.value = textToCopy;
          textArea.style.position = "fixed";
          textArea.style.left = "-9999px";
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand("copy");
          document.body.removeChild(textArea);
        }

        copyButton.classList.add("copied");
        copyButton.replaceChildren(createCheckIcon());

        setTimeout(() => {
          copyButton.classList.remove("copied");
          copyButton.replaceChildren(createCopyIcon());
        }, 2000);
      } catch (err) {
        console.error("Failed to copy code:", err);
      }
    });

    targetElement.style.position = "relative";
    targetElement.appendChild(copyButton);
  });
};

const handleKeydown = (e) => {
  if (e.key === "Escape" && isOpen.value) {
    closeModal();
  }
};

onMounted(() => {
  document.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown);
  document.body.style.overflow = "";
});
</script>

<style scoped>
.issue-card {
  background: var(--noir-raised);
  border: 1px solid var(--noir-border);
  border-left: 3px solid var(--color-error);
  border-radius: var(--radius);
  padding: 16px;
  margin: 12px 0;
  cursor: pointer;
  position: relative;
  transition: border-color 0.15s ease;
}

.issue-card:hover {
  border-color: var(--accent);
}

.issue-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.issue-header h3 {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 600;
  color: var(--noir-text);
}

.expand-hint {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--noir-text-3);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.issue-card:hover .expand-hint {
  opacity: 1;
}

.issue-preview {
  font-size: 13px;
  color: var(--noir-text-2);
  line-height: 1.5;
}

.issue-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
  backdrop-filter: blur(8px);
}

.modal-content {
  background: var(--noir-raised);
  border: 1px solid var(--noir-border);
  border-radius: var(--radius);
  width: 90vw;
  max-width: 800px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--noir-border);
  background: var(--noir-raised);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.modal-title {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.modal-title h2 {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 600;
  color: var(--noir-text);
}

.problem-badge {
  background: rgba(248, 113, 113, 0.15);
  color: var(--color-error);
  padding: 4px 8px;
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  width: fit-content;
}

.solution-badge {
  background: var(--accent-tint);
  color: var(--accent);
  padding: 4px 8px;
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  width: fit-content;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--noir-text-3);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  transition: all 0.15s ease;
  margin-left: 16px;
}

.close-btn:hover {
  background: var(--noir-raised);
  color: var(--noir-text);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.solution-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.solution-title {
  display: flex;
  align-items: center;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.solution-content {
  line-height: 1.6;
}

.solution-content :deep(pre) {
  margin: 16px 0;
  border-radius: var(--radius);
  position: relative;
}

.solution-content :deep(code) {
  font-size: 13px;
}

.solution-content :deep(.copy-btn) {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  border: 1px solid var(--noir-border);
  border-radius: var(--radius);
  width: 32px;
  height: 32px;
  background-color: var(--noir-bg);
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--noir-text-3);
  opacity: 0;
}

.solution-content :deep(pre:hover .copy-btn),
.solution-content :deep(code:hover .copy-btn) {
  opacity: 1;
}

.solution-content :deep(.copy-btn:hover) {
  border-color: var(--accent);
  color: var(--accent);
}

.solution-content :deep(.copy-btn.copied) {
  border-color: var(--accent);
  background-color: var(--accent-tint);
  color: var(--accent);
  opacity: 1;
}

.solution-content :deep(ul),
.solution-content :deep(ol) {
  margin: 12px 0;
  padding-left: 20px;
}

.solution-content :deep(li) {
  margin: 6px 0;
  line-height: 1.5;
}

.solution-content :deep(p) {
  margin: 12px 0;
}

.solution-content :deep(strong) {
  color: var(--accent);
}

@media (max-width: 768px) {
  .modal-content {
    width: 95vw;
    max-height: 90vh;
    border-radius: 0;
  }

  .modal-header {
    padding: 16px 20px;
  }

  .modal-body {
    padding: 20px;
  }

  .issue-card {
    padding: 14px;
  }

  .issue-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .expand-hint {
    opacity: 1;
  }
}
</style>
