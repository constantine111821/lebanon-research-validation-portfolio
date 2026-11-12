"use client";

import { useEffect } from "react";

function workspaceDestination() {
  const { pathname, search, hash } = window.location;
  // Legacy workspace redraws also update the draft in this hash. Only a
  // different view or case is a destination change.
  if (hash.startsWith("#workspace=")) {
    try {
      const context = JSON.parse(decodeURIComponent(hash.slice(11)));
      return JSON.stringify([pathname, search, context.view, context.current]);
    } catch {
      return pathname + search;
    }
  }
  return pathname + search;
}

/** Local visual feedback only. Reads existing status text; never performs an action. */
export function StudioPreviewFeedback() {
  useEffect(() => {
    if (document.body.dataset.studioPreview !== "true") return;
    const motion = document.body.dataset.studioMotion === "true";
    let enteredDestination: string | undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (motion) {
        const destination = workspaceDestination();
        const surface = document.querySelector<HTMLElement>(
          "main:is(.container, .sign-in, .sc019):not([hidden])",
        );
        if (surface && destination !== enteredDestination) {
          enteredDestination = destination;
          surface.dataset.studioMotionEnter = "page";
        }
      }
      document.querySelectorAll<HTMLElement>(".private-save-status").forEach((bar) => {
        const message = bar.textContent?.trim() ?? "";
        const state = message === "Saving" ? "saving"
          : message === "Saved privately" ? "saved"
          : /^(Save failed|Conflicted)(:|$)/.test(message) ? "error" : "idle";
        if (bar.dataset.studioSaveState !== state) bar.dataset.studioSaveState = state;
      });
    };
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(update);
    });
    // Excludes attributes, so our visual annotations cannot trigger another pass.
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return null;
}
