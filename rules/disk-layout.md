# Disk Layout — T0 (Rodolphe's desktop)

**`/` IS FOR FEDORA ONLY. Everything else lives on `/data` with a symlink.**

Root partition is 67 GB. Fedora + drivers + flatpak eats ~40 GB. That leaves zero margin for AI toolchains, model weights, or wheel caches. Accepting installer defaults under `/usr/local`, `/opt`, or `~/.cache` will fill `/` and kill the machine.

## Canonical layout

| What | Where | Symlink from | Env / config |
|---|---|---|---|
| CUDA toolkit | `/data/opt/cuda-<version>` | `/usr/local/cuda-<version>` | alternatives-managed `cuda` link |
| NVIDIA nsight / profilers | `/data/opt/nvidia` | `/opt/nvidia` | — |
| HuggingFace models | `/data/models/hf` | `~/.cache/huggingface` | `HF_HOME=/data/models/hf` in `~/.zshenv` |
| pip wheel cache | `/data/cache/pip` | `~/.cache/pip` | `pip config set global.cache-dir /data/cache/pip` |
| bun / npm / yarn caches | `/data/cache/<name>` | `~/.cache/<name>` | per-tool config |
| Podman / Docker storage | `/data/containers`, `/data/docker` | bind-mount or `storage.conf` | — |

## Rules

1. **Never install a toolchain, model, or cache under `/`.** Install into `/data/...` and symlink back.
2. **Before any multi-GB install: `df -h /`.** If `/` has <10 GB free, stop and fix the layout first.
3. **If an installer hardcodes a `/` path**, let it finish, `rsync -aHAX SRC/ /data/opt/…/` → verify `du -sb` matches → `rm -rf` source → `ln -s` at the original path.
4. **Cache env vars go in `~/.zshenv`, not `.zshrc`.** `.zshrc` is only sourced by interactive shells — systemd services, scripts, and Claude Code's non-interactive zsh will miss it.
5. **Allowed on `/`**: dnf/rpm packages, `/var/lib/flatpak`, `/etc`, system logs. Nothing user-installed.

## Recovery history (April 2026)

29 GB recovered from `/` (was 99%, 984 MB free): CUDA 12.8 stale (6.7 GB deleted), ollama (4.8 GB deleted), CUDA 12.9 → `/data/opt/` (7.3 GB), nsight → `/data/opt/nvidia` (3.3 GB), HF cache → `/data/models/hf` (1.8 GB), pip cache → `/data/cache/pip` (4.6 GB). Final: 38 GB used, 30 GB free.
