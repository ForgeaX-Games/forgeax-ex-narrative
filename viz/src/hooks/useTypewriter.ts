import { useState, useEffect, useRef } from "react";

/**
 * Typewriter effect hook — time-based character reveal.
 * When `active` is true, reveals `text` at `msPerChar` milliseconds per character.
 * When `active` is false, returns the full text immediately.
 */
export function useTypewriter(
  text: string,
  active: boolean,
  msPerChar = 30,
): string {
  const [displayed, setDisplayed] = useState("");
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active || !text) {
      setDisplayed(text);
      indexRef.current = text.length;
      return;
    }

    indexRef.current = 0;
    setDisplayed("");

    timerRef.current = setInterval(() => {
      indexRef.current += 1;
      if (indexRef.current >= text.length) {
        indexRef.current = text.length;
        setDisplayed(text);
        if (timerRef.current != null) clearInterval(timerRef.current);
      } else {
        setDisplayed(text.slice(0, indexRef.current));
      }
    }, msPerChar);

    return () => {
      if (timerRef.current != null) clearInterval(timerRef.current);
    };
  }, [text, active, msPerChar]);

  return displayed;
}
