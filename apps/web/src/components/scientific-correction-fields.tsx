"use client";
import { useId, useState, type ComponentPropsWithoutRef } from "react";
import {
  fieldLabel,
  valueLabel,
  type CorrectionTarget,
  type ScientificData,
  type ScientificValue,
} from "@/lib/corrections";

export function ActionButton({
  hint,
  children,
  ...props
}: ComponentPropsWithoutRef<"button"> & { hint: string }) {
  const descriptionId = useId();
  const [dismissed, setDismissed] = useState(false);
  return (
    <span
      className="scientific-control"
      data-tip-dismissed={dismissed || undefined}
      tabIndex={props.disabled ? 0 : undefined}
      role={props.disabled ? "group" : undefined}
      aria-describedby={props.disabled ? descriptionId : undefined}
      onMouseEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setDismissed(true);
      }}
    >
      <button {...props} aria-describedby={descriptionId}>
        {children}
      </button>
      <span
        className="scientific-control-tip"
        id={descriptionId}
        role="tooltip"
      >
        {hint}
      </span>
    </span>
  );
}

const options: Record<string, [string, string][]> = {
  support_direction: [
    ["SUPPORTS", "Supports"],
    ["CONTRADICTS", "Challenges"],
    ["LIMITS", "Qualifies"],
    ["CONTEXT_ONLY", "Context"],
  ],
  directness: [
    ["", "Unknown"],
    ["direct", "Direct report / observation"],
    ["secondary", "Reports another source"],
    ["inferred", "Inference"],
    ["indexed-only", "Index excerpt only"],
    ["contextual", "Background context"],
  ],
  originality: [
    ["unknown", "Unknown"],
    ["original", "Original reporting"],
    ["republication", "Republication"],
    ["syndication", "Syndicated reporting"],
    ["repost", "Repost"],
  ],
  source_type: [
    ["news", "News article"],
    ["official", "Official statement"],
    ["humanitarian", "Humanitarian report"],
    ["social", "Social-media post"],
    ["mapping", "Mapping evidence"],
    ["human OSINT", "Human research observation"],
    ["other", "Other"],
  ],
  retrieval_body_status: [
    ["UNKNOWN", "Unknown"],
    ["USABLE_BODY", "Complete source"],
    ["PARTIAL_USABLE_BODY", "Partial source"],
    ["INDEXED_ONLY", "Index excerpt only"],
    ["INACCESSIBLE_NEUTRAL", "Inaccessible"],
    ["DUPLICATE_OR_DEPENDENT", "Dependent copy"],
  ],
};
export function Choice({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: [string, string][];
  onChange: (value: string) => void;
}) {
  const fieldId = useId();
  const rows = choices.some(([v]) => v === value)
    ? choices
    : [[value, valueLabel(value)], ...choices];
  return (
    <div className="sc019-field">
      <label htmlFor={fieldId}>{label}</label>
      <select
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {rows.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
export function TextField({
  name,
  value,
  onChange,
  required = false,
  completionRequired = false,
}: {
  name: string;
  value: ScientificValue | undefined;
  onChange: (value: ScientificValue) => void;
  required?: boolean;
  completionRequired?: boolean;
}) {
  const fieldId = useId();
  return (
    <div className="sc019-field">
      <label htmlFor={fieldId}>{fieldLabel(name)}</label>
      <textarea
        id={fieldId}
        rows={name === "reason" ? 3 : 2}
        required={required}
        data-required-text={completionRequired ? "true" : undefined}
        maxLength={name === "reason" ? 4000 : 20000}
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </div>
  );
}
// Existing structured values remain structured; the editor never parses a JSON text box.
export function StructuredField({
  name,
  value,
  onChange,
  completionRequired = false,
}: {
  name: string;
  value: ScientificValue | undefined;
  onChange: (value: ScientificValue) => void;
  completionRequired?: boolean;
}) {
  if (Array.isArray(value)) {
    const needsPassage =
      completionRequired &&
      name === "evidence_locator" &&
      !value.some(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          entry.locator &&
          entry.excerpt,
      );
    return (
      <fieldset>
        <legend>{fieldLabel(name)}</legend>
        {value.map((entry, i) => (
          <StructuredField
            key={i}
            name={`${name === "evidence_locator" ? "Passage" : fieldLabel(name)} ${i + 1}`}
            value={entry}
            completionRequired={needsPassage && i === 0}
            onChange={(next) =>
              onChange(value.map((v, n) => (n === i ? next : v)))
            }
          />
        ))}
        {name === "evidence_locator" && (
          <button
            type="button"
            onClick={() => onChange([...value, { locator: "", excerpt: "" }])}
          >
            Add passage reference
          </button>
        )}
      </fieldset>
    );
  }
  if (value && typeof value === "object")
    return (
      <fieldset>
        <legend>{fieldLabel(name)}</legend>
        {Object.entries(value).map(([key, entry]) => (
          <StructuredField
            key={key}
            name={key}
            value={entry}
            completionRequired={
              completionRequired && (key === "locator" || key === "excerpt")
            }
            onChange={(next) => onChange({ ...value, [key]: next })}
          />
        ))}
      </fieldset>
    );
  if (typeof value === "boolean")
    return (
      <Choice
        label={fieldLabel(name)}
        value={String(value)}
        choices={[
          ["unknown", "Unknown"],
          ["true", "Yes — explicitly recorded"],
          ["false", "No — explicitly recorded"],
        ]}
        onChange={(v) => onChange(v === "unknown" ? null : v === "true")}
      />
    );
  if (typeof value === "number")
    return (
      <label>
        {fieldLabel(name)}
        <input
          type="number"
          step="any"
          value={value}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
        />
      </label>
    );
  if (options[name])
    return (
      <Choice
        label={fieldLabel(name)}
        value={String(value || "")}
        choices={options[name]}
        onChange={(v) => onChange(v === "" ? null : v)}
      />
    );
  if (name === "evidence_locator")
    return <StructuredField name={name} value={[]} onChange={onChange} />;
  if (name === "dependency_provenance" && value == null)
    return (
      <StructuredField
        name={name}
        value={{ relies_on: "unknown", underlying: null, independence: null }}
        onChange={onChange}
      />
    );
  if (name === "social_fields" && value == null)
    return (
      <StructuredField
        name={name}
        value={{
          platform: "Unknown",
          account: "Unknown",
          post_id: "Unknown",
          timestamp_status: "Unknown",
          access: "Unknown",
          originality: "unknown",
          geo_status: "Unverified",
          chronology_status: "Unverified",
          facility_match: "Unverified",
          preservation: "Unknown",
          limitations: "Unknown",
        }}
        onChange={onChange}
      />
    );
  if (name === "content_preservation_status" && value == null)
    return (
      <StructuredField
        name={name}
        value={{ excerpt: null, preservation: null }}
        onChange={onChange}
      />
    );
  return (
    <TextField
      name={name}
      value={value}
      onChange={onChange}
      completionRequired={completionRequired}
    />
  );
}
export function DateFields({
  value,
  precision,
  onChange,
}: {
  value: ScientificValue | undefined;
  precision: string;
  onChange: (value: ScientificValue, precision: string) => void;
}) {
  const range =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return (
    <fieldset>
      <legend>Date and uncertainty</legend>
      <Choice
        label="Date precision"
        value={precision}
        choices={[
          ["UNKNOWN", "Unknown"],
          ["DAY", "Exact day"],
          ["MONTH", "Month only"],
          ["APPROXIMATE", "Approximate"],
          ["RANGE", "Date range"],
        ]}
        onChange={(p) =>
          onChange(p === "RANGE" ? { start: "", end: "" } : null, p)
        }
      />
      {precision === "UNKNOWN" ? (
        <p>Remains unknown. No date is inferred.</p>
      ) : precision === "RANGE" ? (
        <div className="sc019-grid">
          {["start", "end"].map((key) => (
            <label key={key}>
              Range {key}
              <input
                type="date"
                required
                value={String(range[key] || "")}
                onChange={(e) =>
                  onChange({ ...range, [key]: e.target.value }, precision)
                }
              />
            </label>
          ))}
        </div>
      ) : (
        <label>
          {precision === "APPROXIMATE"
            ? "Recorded approximate period"
            : "Recorded date"}
          <input
            required
            type={
              precision === "DAY"
                ? "date"
                : precision === "MONTH"
                  ? "month"
                  : "text"
            }
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || null, precision)}
          />
        </label>
      )}
    </fieldset>
  );
}
export function ProposalFields({
  draft,
  update,
}: {
  draft: { target: CorrectionTarget; proposed: ScientificData };
  update: (data: ScientificData) => void;
}) {
  const data = draft.proposed,
    set = (key: string, value: ScientificValue) =>
      update({ ...data, [key]: value });
  const input = (key: string) => (
    <StructuredField
      key={key}
      name={key}
      value={data[key]}
      onChange={(value) => set(key, value)}
    />
  );
  if (draft.target === "fact")
    return (
      <>
        <TextField
          name="subject"
          value={data.subject}
          onChange={(v) => set("subject", v)}
          required
        />
        {data.value_type === "BOOLEAN" ? (
          <Choice
            label="Recorded value"
            value={
              data.current_verified_value == null
                ? "unknown"
                : String(data.current_verified_value)
            }
            choices={[
              ["unknown", "Unknown — not established"],
              ["true", "Yes — explicitly recorded"],
              ["false", "No — explicitly recorded"],
            ]}
            onChange={(v) =>
              set(
                "current_verified_value",
                v === "unknown" ? null : v === "true",
              )
            }
          />
        ) : ["DATE", "DATE_RANGE"].includes(String(data.value_type)) ? (
          <DateFields
            value={data.current_verified_value}
            precision={String(data.date_precision || "UNKNOWN")}
            onChange={(value, precision) =>
              update({
                ...data,
                current_verified_value: value,
                date_precision: precision,
                value_type: precision === "RANGE" ? "DATE_RANGE" : "DATE",
              })
            }
          />
        ) : data.value_type === "QUANTITATIVE" ? (
          <>
            <label>
              Recorded quantity — blank means unknown
              <input
                type="number"
                step="any"
                value={
                  typeof data.current_verified_value === "number"
                    ? data.current_verified_value
                    : ""
                }
                onChange={(e) =>
                  set(
                    "current_verified_value",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </label>
            {input("quantitative_unit")}
            {input("impact_basis")}
          </>
        ) : (
          input("current_verified_value")
        )}
        <p className="sc019-muted">
          Correct the same proposition. A genuinely different claim belongs in
          Add new fact. Unknown information is not evidence of absence.
        </p>
        {input("review_notes")}
        {input("open_factual_question")}
      </>
    );
  if (draft.target === "evidence")
    return (
      <>
        {["support_direction", "evidence_locator", "limitations"].map(input)}
        <details>
          <summary>Directness, originality and reporting dependencies</summary>
          {[
            "directness",
            "originality",
            "evidence_role",
            "dependency_group_id",
            "dependency_provenance",
          ].map(input)}
        </details>
      </>
    );
  const publication =
    data.publication_date &&
    typeof data.publication_date === "object" &&
    !Array.isArray(data.publication_date)
      ? data.publication_date
      : null;
  return (
    <>
      {[
        "title",
        "original_url",
        "canonical_url",
        "publisher_platform",
        "source_type",
      ].map(input)}
      {publication || data.publication_date == null ? (
        <DateFields
          value={publication?.value}
          precision={String(publication?.precision || "UNKNOWN")}
          onChange={(value, precision) =>
            set("publication_date", { ...publication, value, precision })
          }
        />
      ) : (
        input("publication_date")
      )}
      <details>
        <summary>
          Access, preservation and other recorded citation details
        </summary>
        {[
          "retrieval_body_status",
          "content_preservation_status",
          "evidence_locator",
          "limitations",
          "social_fields",
        ].map(input)}
      </details>
    </>
  );
}
