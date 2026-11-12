"use client";

import { useEffect, useRef } from "react";

type TextField = HTMLInputElement | HTMLTextAreaElement;
type FieldPresentation = {
  message?: { visual: HTMLSpanElement; description: HTMLSpanElement };
  previousInvalid?: string | null;
  previousRequired?: string | null;
};

const fieldSelector = "input[required], input[data-required-text], textarea[required], textarea[data-required-text]";
const textInputTypes = new Set([
  "text", "search", "email", "password", "url", "tel", "number", "date",
  "datetime-local", "month", "time", "week",
]);
const stepScope = "[data-required-text-scope]";
const stepButton = "button[data-required-text-submit], button[data-manual-next]";

function isTextField(element: unknown): element is TextField {
  return element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && textInputTypes.has(element.type));
}

function isRequired(field: TextField) {
  const marker = field.getAttribute("data-required-text");
  return field.required || (marker !== null && marker !== "false");
}

function isActive(field: TextField) {
  if (!field.form || field.readOnly || field.matches(":disabled") ||
      field.closest('[hidden], [inert], [aria-hidden="true"]') ||
      getComputedStyle(field).visibility !== "visible") return false;
  if (field.getClientRects().length) return true;
  // Collapsing details does not remove a field from the current form step.
  const closedDetails = "details:not([open])";
  if (!field.closest(closedDetails)) return false;
  for (let ancestor: Element | null = field; ancestor; ancestor = ancestor.parentElement) {
    if (getComputedStyle(ancestor).display === "none") return false;
    if (ancestor.matches(closedDetails) && ancestor.getClientRects().length) return true;
  }
  return false;
}

function isEmpty(field: TextField) {
  if (field.validity.badInput) return false;
  return field.type === "password" ? !field.value : !field.value.trim();
}

function restoreAttribute(field: TextField, name: string, previous: string | null | undefined) {
  if (previous === undefined || field.getAttribute(name) !== "true") return;
  if (previous === null) field.removeAttribute(name);
  else field.setAttribute(name, previous);
}

export function RequiredFieldGuidance() {
  const announcement = useRef<HTMLSpanElement>(null);
  const descriptions = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const fields = new Map<TextField, FieldPresentation>();
    let nextId = 0;
    let frame = 0;
    let announcementFrame = 0;

    function clearMissing(field: TextField, state: FieldPresentation) {
      field.removeAttribute("data-required-field-state");
      restoreAttribute(field, "aria-invalid", state.previousInvalid);
      state.previousInvalid = undefined;
      if (!state.message) return;
      const ids = (field.getAttribute("aria-describedby") || "").split(/\s+/)
        .filter((id) => id && id !== state.message?.description.id);
      if (ids.length) field.setAttribute("aria-describedby", ids.join(" "));
      else field.removeAttribute("aria-describedby");
      state.message.visual.remove();
      state.message.description.remove();
      state.message = undefined;
    }

    function clear(field: TextField, state: FieldPresentation) {
      clearMissing(field, state);
      restoreAttribute(field, "aria-required", state.previousRequired);
      fields.delete(field);
    }

    function showMissing(field: TextField, state: FieldPresentation, attempted: boolean) {
      const missing = attempted || field.dataset.requiredFieldState === "missing";
      field.dataset.requiredFieldState = missing ? "missing" : "empty";
      if (missing && field.getAttribute("aria-invalid") !== "true") {
        state.previousInvalid = field.getAttribute("aria-invalid");
        field.setAttribute("aria-invalid", "true");
      }
      if (!state.message) {
        const visual = document.createElement("span");
        visual.className = "required-field-message";
        visual.setAttribute("aria-hidden", "true");
        const description = document.createElement("span");
        description.id = `required-field-message-${++nextId}`;
        // An implicit label may wrap the input. Keep its label text independent of the hint.
        descriptions.current?.append(description);
        state.message = { visual, description };
      }
      const { visual, description } = state.message;
      const text = missing ? "Fill in this required field." : "Required";
      if (description.textContent !== text) description.textContent = text;
      if (visual.previousElementSibling !== field) field.after(visual);
      const ids = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      if (!ids.includes(description.id)) field.setAttribute("aria-describedby", [...ids, description.id].join(" "));
    }

    function update(field: TextField, attempted = false) {
      const existing = fields.get(field);
      if (!isRequired(field) || !isActive(field)) {
        if (existing) clear(field, existing);
        return false;
      }
      const state = existing || {};
      fields.set(field, state);
      if (!field.required && field.getAttribute("aria-required") !== "true") {
        state.previousRequired = field.getAttribute("aria-required");
        field.setAttribute("aria-required", "true");
      } else if (field.required) {
        restoreAttribute(field, "aria-required", state.previousRequired);
        state.previousRequired = undefined;
      }
      if (!isEmpty(field)) {
        clearMissing(field, state);
        return false;
      }
      showMissing(field, state, attempted);
      return true;
    }

    function scan() {
      frame = 0;
      for (const [field, state] of fields) {
        if (!field.isConnected || !field.matches(fieldSelector) || !isTextField(field)) clear(field, state);
      }
      for (const field of document.querySelectorAll(fieldSelector)) {
        if (isTextField(field)) update(field);
      }
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(scan);
    }

    function announce(count: number) {
      const live = announcement.current;
      if (!live || !count) return;
      cancelAnimationFrame(announcementFrame);
      live.textContent = "";
      announcementFrame = requestAnimationFrame(() => {
        live.textContent = count === 1 ? "Fill in the required field." : `Fill in the ${count} required fields.`;
      });
    }

    function attempt(form: HTMLFormElement, scope?: Element) {
      let missing = 0;
      for (const field of form.elements) {
        if (!isTextField(field) || !field.matches(fieldSelector)) continue;
        // A separate manual action can validate its own fields within a larger form.
        if (scope ? !scope.contains(field) : !field.required && field.closest(stepScope)) continue;
        if (update(field, true)) missing++;
      }
      return missing;
    }

    function onInvalid(event: Event) {
      const target = event.target;
      if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
           target instanceof HTMLSelectElement) && target.form) {
        attempt(target.form);
      }
    }

    function onSubmit(event: SubmitEvent) {
      if (event.target instanceof HTMLFormElement) announce(attempt(event.target));
    }

    function onStep(event: MouseEvent) {
      const button = event.target instanceof Element && event.target.closest<HTMLButtonElement>(stepButton);
      if (button && button.form && !button.matches(":disabled")) {
        announce(attempt(button.form, button.closest(stepScope) || undefined));
      }
    }

    function onFieldChange(event: Event) {
      if (isTextField(event.target)) update(event.target);
      if (event.type === "change") schedule();
    }

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden", "inert", "aria-hidden", "class", "style", "open", "disabled",
        "readonly", "required", "type", "data-required-text"],
    });
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("click", onStep, true);
    document.addEventListener("input", onFieldChange);
    document.addEventListener("change", onFieldChange);
    document.addEventListener("focusin", onFieldChange);
    document.addEventListener("reset", schedule);
    scan();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(announcementFrame);
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("click", onStep, true);
      document.removeEventListener("input", onFieldChange);
      document.removeEventListener("change", onFieldChange);
      document.removeEventListener("focusin", onFieldChange);
      document.removeEventListener("reset", schedule);
      for (const [field, state] of fields) clear(field, state);
    };
  }, []);

  return <>
    <span ref={announcement} className="required-field-announcement" aria-live="polite" aria-atomic="true" />
    <span ref={descriptions} hidden />
  </>;
}
