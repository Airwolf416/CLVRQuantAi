---
name: Docker build in Replit dev container
description: Why a full `docker build` can't be completed in the Replit dev container, and how to verify Dockerfiles here instead.
---

# Local `docker build` in the Replit dev container

Docker IS available in the dev container, but a **full image build of this app cannot reliably complete here** — it OOM-kills shells (exit 137) and runs for 20+ min on the pip step alone.

**Why:**
- The dev container is ~7.7GB total and CPU/IO-throttled. The heavy work this app's image does — `npm ci` of a large tree + vite/esbuild build + a scientific-stack `pip install` (numpy/pandas/scipy/arch) — is the exact load that OOM'd Railway's builder in the first place. This is precisely what the prebuilt-image migration offloads to GitHub Actions (16GB).
- The default/minimal `.dockerignore` does NOT exclude Replit-only dirs `.cache` (~1.1GB) and `.pythonlibs` (~465MB). They are git-untracked, so they're absent from a CI checkout, but locally they bloat the `docker build` context to ~1.6GB and stall "load build context". A `COPY . .` drags them in.

**How to verify a Dockerfile here without a full build:**
1. `docker build --check -f <file> .` — validates structure/best-practices, fast and low-memory.
2. For a partial real build, build with a TEMP verification ignore file (BuildKit uses `<Dockerfile>.dockerignore` next to a `-f`-named Dockerfile) that ALSO excludes `.cache .pythonlibs .config .upm .agents .local clvrquant_full_code_export.txt *.png` — this shrinks the context so npm/COPY/venv steps run; expect the scientific-stack pip compile to still be the long pole. Delete the temp files after.
3. Defer the full image build to GitHub Actions — the spec for this migration explicitly says a local full build can be skipped and is not a failure.

**Secret-baking gotcha:** a minimal `.dockerignore` that drops `.env*` will bake a local `.env` into image layers via `COPY . .` on any LOCAL build (CI is unaffected — no `.env` in the checkout). Prefer keeping `.env*` ignored, or don't leave local test images around.
