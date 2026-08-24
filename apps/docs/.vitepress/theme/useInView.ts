import { onBeforeUnmount, onMounted, type Ref, ref } from "vue";

/**
 * One-shot viewport visibility. Flips to true the first time `target`
 * intersects, then disconnects. Under prefers-reduced-motion (or when
 * IntersectionObserver is unavailable, e.g. SSR) it is true immediately
 * so diagrams render their final frame.
 */
export function useInView(target: Ref<Element | null>, threshold = 0.4): Ref<boolean> {
  const inView = ref(false);
  let observer: IntersectionObserver | undefined;

  onMounted(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined" || !target.value) {
      inView.value = true;
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          inView.value = true;
          observer?.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(target.value);
  });

  onBeforeUnmount(() => observer?.disconnect());
  return inView;
}
