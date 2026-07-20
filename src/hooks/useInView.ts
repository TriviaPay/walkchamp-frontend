import { useEffect, useRef, useState } from 'react';

type InViewOptions = IntersectionObserverInit & {
  once?: boolean;
};

export const useInView = <T extends HTMLElement>(
  options: InViewOptions = {},
) => {
  const {
    once = true,
    root = null,
    rootMargin = '0px',
    threshold = 0,
  } = options;
  const elementRef = useRef<T>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const node = elementRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) {
          return;
        }

        if (entry.isIntersecting) {
          setIsInView(true);
          if (once) {
            observer.unobserve(node);
          }
        } else if (!once) {
          setIsInView(false);
        }
      },
      {
        root,
        rootMargin,
        threshold,
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [once, root, rootMargin, threshold]);

  return { elementRef, isInView };
};
