"use client";
import { useEffect } from "react";
import "./action-guidance.css";

// Only procedural actions: never choose a case, approval, withdrawal or review decision.
const procedures: Record<string, string> = {
  "sign in": "Open the workspace using your existing account.",
  "review changes": "Inspect your pending changes before saving or submitting.",
  "review proposed changes":
    "Compare the recorded and proposed content before deciding whether to submit.",
  "save private draft":
    "Keep these changes private so you can return to them later.",
  "continue draft": "Reopen your own saved, unsent work.",
  "update private change":
    "Update this pending item without submitting shared research.",
  "add evidence to changes":
    "Add this evidence to your pending changes; it is not submitted yet.",
  "submit fact flag":
    "Send this concern for Supervisor attention without changing the fact.",
  "preview correction package":
    "Compare the original fact and complete proposed evidence package before submitting.",
  "submit for supervisor review":
    "Send this complete proposal for independent review. The current scientific record stays unchanged.",
};
export function ActionGuidance() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let clear: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLButtonElement | null = null;
    const shown = new Set<string>();
    const annotated = () =>
      document.querySelectorAll<HTMLButtonElement>(
        "button[data-procedural-hint]",
      );
    const reset = () => {
      if (clear) clearTimeout(clear);
      current?.removeAttribute("data-procedural-cue");
      current = null;
    };
    const inspect = () => {
      const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
      const scope: ParentNode =
        dialog || document.querySelector("main") || document;
      const candidates = [
        ...scope.querySelectorAll<HTMLButtonElement>("button"),
      ].filter((button) => {
        const label = (button.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase()
          .replace(/\s*\(\d+\)$/, "");
        const hint = procedures[label];
        if (
          !hint ||
          !button.getClientRects().length ||
          getComputedStyle(button).visibility === "hidden" ||
          button.closest('[aria-hidden="true"],[inert]')
        )
          return false;
        // Existing workflow-specific accessible descriptions take precedence.
        if (
          !button.hasAttribute("aria-describedby") &&
          !button.hasAttribute("aria-description")
        ) {
          button.setAttribute("aria-description", hint);
          button.dataset.proceduralHint = hint;
        }
        const form = button.form;
        return (
          !button.matches(":disabled") &&
          button.getAttribute("aria-disabled") !== "true" &&
          !button.closest('[aria-busy="true"]') &&
          (!form || !form.querySelector(':invalid,[aria-invalid="true"]'))
        );
      });
      // Multiple possible actions are a choice for the user, not the guidance system.
      if (candidates.length !== 1) {
        reset();
        return;
      }
      const button = candidates[0];
      const key =
        location.pathname +
        location.hash +
        "|" +
        (button.form?.id || "") +
        "|" +
        button.textContent?.trim();
      if (shown.has(key) || current === button) return;
      reset();
      shown.add(key);
      if (shown.size > 200) shown.delete(shown.values().next().value!);
      current = button;
      button.dataset.proceduralCue = "next";
      clear = setTimeout(reset, 2200);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(inspect, 180);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        reset();
        for (const button of annotated())
          button.dataset.proceduralHintDismissed = "true";
      }
    };
    const reveal = (event: Event) => {
      const button = (event.target as Element)?.closest?.("button");
      button?.removeAttribute("data-procedural-hint-dismissed");
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled", "aria-busy"],
    });
    document.addEventListener("input", schedule);
    document.addEventListener("change", schedule);
    document.addEventListener("keydown", escape);
    document.addEventListener("focusin", reveal);
    document.addEventListener("pointerover", reveal);
    window.addEventListener("popstate", schedule);
    schedule();
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
      reset();
      document.removeEventListener("input", schedule);
      document.removeEventListener("change", schedule);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("focusin", reveal);
      document.removeEventListener("pointerover", reveal);
      window.removeEventListener("popstate", schedule);
      for (const button of annotated()) {
        button.removeAttribute("aria-description");
        button.removeAttribute("data-procedural-hint");
        button.removeAttribute("data-procedural-hint-dismissed");
      }
    };
  }, []);
  return null;
}
