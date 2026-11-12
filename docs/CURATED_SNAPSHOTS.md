# Curated source snapshots

These selected excerpts come from recorded development milestones. The first two show additions at the time. The third shows a before-and-after change. The runnable portfolio is on the default branch.

## October 1, 2026 · Private drafts

The first case and draft slice carried an explicit revision through a draft save. This lets the application distinguish a current edit from one based on an older revision.

```diff
+    const { data, error } = await client.rpc("lab_save_draft", {
+      p_id: input.id,
+      p_expected_revision: input.expected_revision,
+      p_payload: input.payload,
+    });
```

## October 5, 2026 · Portable review packages

The export builder assembled the reviewed dataset and facility geometry, computed a semantic digest, and added a manifest to the ZIP. The verifier could then check the package on its own.

```diff
+  const data=researchDataset(s), geo=featureCollection(data), semantic=sha256(stableJSON(data));
+  files['manifest.json']=stableJSON(manifest);
+  return {bytes:zipFiles(files),files,manifest,data,filename:`research-export-${SCHEMA_VERSION}-${semantic.slice(0,12)}.zip`};
```

## October 7, 2026 · Readable source captures

Reviewers needed to read captured evidence without losing meaningful identifiers. Restricting the line label cleanup to line starts preserved inline identifiers in the readable view. The application continued to retain the exact capture in its advanced details.

```diff
-    .replace(/(^|\n|\s)L\d+:\s?/g, "$1")
+    .replace(/(^|\n)[ \t]*L\d+:[ \t]?/g, "$1")
```
