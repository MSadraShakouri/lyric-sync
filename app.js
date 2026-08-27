
      (() => {
        "use strict";
        const $ = (s) => document.querySelector(s),
          storeKey = "lyric-sync-session-v1";
        let ws = null,
          blocks = [],
          activeId = null,
          speed = 1,
          zoom = 80,
          audioName = "",
          audioData = null,
          raf = 0,
          lastAutoId = null,
          stampedCache = null,
          blocksVersion = 0,
          syncHistoryPushed = false,
          pinch = null;
        let wasPlaying = false;
        let pendingResume = false;
        // multi-select + internal text clipboard (no timestamps)
        let selMode = false;
        const selIds = new Set();
        let clip = [];
        let suppressClick = 0;
        function defaultMeta() {
          return { ti: "", ar: "", al: "", au: "", by: "" };
        }
        let meta = defaultMeta();
        const ids = () =>
          crypto.randomUUID
            ? crypto.randomUUID()
            : "b" + Date.now() + Math.random().toString(36).slice(2);
        const fmt = (ms) => {
          if (ms == null) return "[--:--]";
          ms = Math.max(0, Math.round(ms));
          let c = Math.floor(ms / 10) % 100,
            s = Math.floor(ms / 1000) % 60,
            m = Math.floor(ms / 60000);
          return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}]`;
        };
        const getTime = () => (ws ? Math.round(ws.getCurrentTime() * 1000) : 0);
        function save() {
          try {
            localStorage.setItem(
              storeKey,
              JSON.stringify({
              audioName,
              audioData,
              blocks,
              speed,
              zoom,
              meta,
            }),
            );
          } catch (e) {
            console.warn(e);
            $("#startNotice").textContent =
              "Session saved without audio: browser storage is full.";
          }
        }
        function setScreen(sync) {
          $("#startScreen").classList.toggle("hidden", sync);
          $("#syncScreen").classList.toggle("hidden", !sync);
          if (sync) {
            // Web only: put a dummy history entry in place so the browser
            // back button can be intercepted instead of navigating away.
            if (!isNative && !syncHistoryPushed) pushSyncHistory();
          } else {
            syncHistoryPushed = false;
          }
        }
        /* Parses plain lyrics or an existing LRC file into blocks.
           Handles: header tags [ti]/[ar]/[al]/[au]/[by], [offset:],
           condensed multi-timestamp lines, 2- and 3-digit milliseconds,
           CRLF line endings. Fully-stamped input is sorted by time. */
        const TS_RE = /^\[(\d{2}):(\d{2})[.:](\d{2,3})\]/;
        const TAG_RE = /^\[\s*(ti|ar|al|au|by)\s*:\s*([^\]]*)\s*\]$/i;
        const OFFSET_RE = /^\[\s*offset\s*:\s*(-?\d+)\s*\]$/i;
        const TAG_ANY_RE = /^\[[a-zA-Z][a-zA-Z0-9]*\s*:[^\]]*\]$/;
        function parseLrc(text) {
          if (!text.trim()) return { blocks: [], meta: defaultMeta() };
          const lines = text.replace(/\r\n?/g, "\n").split("\n");
          const result = [];
          const m = defaultMeta();
          let offset = 0;
          for (const raw of lines) {
            const line = raw.trim();
            const tag = line.match(TAG_RE);
            if (tag) {
              m[tag[1].toLowerCase()] = tag[2].trim();
              continue;
            }
            const off = line.match(OFFSET_RE);
            if (off) {
              offset += parseInt(off[1], 10);
              continue;
            }
            // Strip (possibly several) leading timestamps
            let rest = line;
            let count = 0;
            let stripped = false;
            for (;;) {
              const t = rest.match(TS_RE);
              if (!t) break;
              const sec = parseInt(t[2], 10);
              if (sec >= 60) {
                rest = rest.slice(t[0].length); // invalid stamp; drop it
                stripped = true;
                continue;
              }
              const msDigits = t[3];
              const ms =
                (parseInt(t[1], 10) * 60 + sec) * 1000 +
                (msDigits.length === 3
                  ? parseInt(msDigits, 10)
                  : parseInt(msDigits, 10) * 10);
              result.push({ id: ids(), text: null, timestamp: ms });
              rest = rest.slice(t[0].length);
              count++;
            }
            if (count > 0) {
              const txt = rest.trim();
              for (let i = result.length - count; i < result.length; i++)
                result[i].text = txt;
            } else if (TAG_ANY_RE.test(line)) {
              // Unknown tag line ([re:], [ve:], ...) — not a lyric
            } else {
              // No timestamp – keep line as is (unless a bad stamp was stripped)
              result.push({ id: ids(), text: stripped ? rest.trim() : raw, timestamp: null });
            }
          }
          if (offset !== 0)
            for (const b of result)
              if (b.timestamp != null)
                b.timestamp = Math.max(0, b.timestamp + offset);
          if (
            result.length > 0 &&
            result.every((b) => b.timestamp != null)
          )
            result.sort((a, b) => a.timestamp - b.timestamp);
          return { blocks: result, meta: m };
        }
        function render() {
          const list = $("#lyricsList");
          list.innerHTML = "";
          blocks.forEach((b, i) => {
            const el = document.createElement("article");
            el.className =
              "block" +
              (b.id === activeId ? " active" : "") +
              (selMode && selIds.has(b.id) ? " selected" : "");
            el.dataset.id = b.id;
            el.innerHTML = `<div class="left"><button class="nudge" data-act="plus">+0.1</button><button class="stamp-time" data-act="time">${fmt(b.timestamp)}</button><button class="nudge" data-act="minus">−0.1</button></div><div class="line ${b.text === "" ? "empty" : ""}" data-act="select" dir="auto">${escapeHTML(b.text)}</div><div class="right"><button class="icon" data-act="from" aria-label="Play from here">▶</button><button class="stamp" data-act="stamp">STAMP</button><button class="icon" data-act="more" aria-label="More options">⋯</button></div>`;
            list.append(el);
          });
        }
        function escapeHTML(s) {
          return s.replace(
            /[&<>'"]/g,
            (c) =>
              ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                "'": "&#39;",
                '"': "&quot;",
              })[c],
          );
        }
        function select(id, seek = false, center = false) {
          activeId = id;
          render();
          const b = blocks.find((x) => x.id === id);
          if (seek && b?.timestamp != null) ws.setTime(b.timestamp / 1000);
          if (center) {
            requestAnimationFrame(() =>
              document
                .querySelector(`.block[data-id="${id}"]`)
                ?.scrollIntoView({ block: "center", behavior: "smooth" }),
            );
          }
        }
        function change(id, fn) {
          const b = blocks.find((x) => x.id === id);
          if (!b) return;
          fn(b);
          bumpBlocks();
          save();
          render();
        }
        function waveInit(data) {
          if (typeof WaveSurfer === "undefined") {
            $("#startNotice").textContent =
              "The waveform library could not be loaded. Check your connection and reload the page.";
            setScreen(false);
            return;
          }
          if (ws) ws.destroy();
          ws = WaveSurfer.create({
            container: "#waveform",
            url: data,
            height: Math.max(80, innerHeight * 0.3),
            waveColor: "#527985",
            progressColor: "#62d6ff",
            cursorColor: "#fff",
            cursorWidth: 2,
            barWidth: 2,
            barGap: 1,
            normalize: true,
            autoScroll: true,
            autoCenter: true,
            dragToSeek: true,
            minPxPerSec: zoom,
          });
          ws.on("ready", () => {
            ws.setPlaybackRate(speed);
            $("#nowLabel").textContent = fmt(0).slice(1, -1);
          });
          ws.on("play", () => {
            if (raf) {
              cancelAnimationFrame(raf);
              raf = 0;
            }
            updatePlay(); // icon flips immediately
            tick();       // highlight work after
          });
          ws.on("pause", () => {
            // Stop the animation loop when paused
            if (raf) {
              cancelAnimationFrame(raf);
              raf = 0;
            }
            updatePlay();
          });
          ws.on("finish", () => {
            if (raf) {
              cancelAnimationFrame(raf);
              raf = 0;
            }
            updatePlay();
          });
        }
        function updatePlay() {
          $("#playBtn").textContent = ws && !ws.isPlaying() ? "▶" : "❚❚";
        }
        function bumpBlocks() {
          blocksVersion++;
          stampedCache = null;
        }
        function getStamped() {
          // Rebuilt lazily: only when blocks/timestamps actually change.
          if (stampedCache === null) {
            stampedCache = blocks.filter((b) => b.timestamp != null);
          }
          return stampedCache;
        }
        function highlight(id) {
          // Class toggle instead of a full render(): the tick loop must never
          // rebuild the whole lyrics list (that is what made playback janky).
          if (id === activeId) return false;
          const prev = document.querySelector(".block.active");
          const next = document.querySelector(`.block[data-id="${id}"]`);
          activeId = id;
          if (prev) prev.classList.remove("active");
          if (next) next.classList.add("active");
          return true;
        }
        function tick() {
          if (!ws || !ws.isPlaying()) return;
          if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
          }
          const t = getTime();
          $("#nowLabel").textContent = fmt(t).slice(1, -1);

          const stamped = blocks.filter((b) => b.timestamp != null);
          if (stamped.length) {
            // Closest stamped line (original behavior)
            let closest = stamped[0];
            let best = Math.abs(closest.timestamp - t);
            for (let i = 1; i < stamped.length; i++) {
              const d = Math.abs(stamped[i].timestamp - t);
              if (d < best) {
                best = d;
                closest = stamped[i];
              }
            }
            if (closest.id !== activeId) {
              // Class toggle instead of full render
              const prev = document.querySelector(".block.active");
              const next = document.querySelector(`.block[data-id="${closest.id}"]`);
              activeId = closest.id;
              if (prev) prev.classList.remove("active");
              if (next) next.classList.add("active");
              // Auto-scroll
              if (lastAutoId !== closest.id) {
                lastAutoId = closest.id;
                document
                  .querySelector(`.block[data-id="${closest.id}"]`)
                  ?.scrollIntoView({ block: "center", behavior: "smooth" });
              }
            }
          }
          raf = requestAnimationFrame(tick);
        }
        function stamp(id) {
          change(id, (b) => (b.timestamp = getTime()));
          activeId = id;
          render();
          document
            .querySelector(`.block[data-id="${id}"]`)
            ?.classList.add("flash");
        }
        function showSheet(id) {
          // Pause audio if playing
          wasPlaying = ws?.isPlaying() || false;
          if (wasPlaying && ws) ws.pause();
          pendingResume = false;

          const b = blocks.find((x) => x.id === id);
          const hasTime = b?.timestamp != null;
          $("#overlay").innerHTML =
            `<div class="sheet-backdrop"><div class="sheet"><div class="handle"></div>
            <button data-menu="edit">Edit line</button>
            <button data-menu="insertbelow">Insert lines below</button>
            ${clip.length ? '<button data-menu="paste">Paste below</button>' : ""}
            <button data-menu="copy">Copy</button>
            <button data-menu="copybelow">Copy below</button>
            <button data-menu="cut">Cut</button>
            ${hasTime ? '<button data-menu="cleartime">Clear time</button>' : ""}
            <button data-menu="moveup">Move up</button>
            <button data-menu="movedown">Move down</button>
            <button class="delete" data-menu="delete">Delete line</button>
          </div></div>`;

          const close = () => {
            $("#overlay").innerHTML = "";
            pendingResume = wasPlaying;
            setTimeout(checkResume, 50);
          };

          $(".sheet-backdrop").onclick = (e) => {
            if (e.target === e.currentTarget) close();
          };

          $(".sheet").onclick = (e) => {
            let action = e.target.dataset.menu;
            if (!action) return;
            if (action === "edit") {
              close();
              editText(id);
            } else if (action === "insertbelow") {
              close();
              insertLinesBelow(id);
            } else {
              let i = blocks.findIndex((x) => x.id === id);
              if (action === "paste") {
                blocks.splice(
                  i + 1,
                  0,
                  ...clip.map((t) => ({ id: ids(), text: t, timestamp: null })),
                );
                toast(
                  "Pasted " + clip.length + (clip.length === 1 ? " line" : " lines"),
                );
                clip = []; // consumed; "Paste below" disappears again
              } else if (action === "copy") {
                clip = [b.text];
                toast("Copied 1 line");
              } else if (action === "copybelow") {
                blocks.splice(i + 1, 0, { id: ids(), text: b.text, timestamp: null });
                toast("Copied below");
              } else if (action === "cut") {
                clip = [b.text];
                blocks.splice(i, 1);
                if (activeId === id)
                  activeId =
                    blocks[Math.min(i, blocks.length - 1)]?.id || null;
                toast("Cut 1 line");
              } else if (action === "cleartime") {
                blocks[i].timestamp = null;
                toast("Time cleared");
              } else if (action === "moveup") {
                if (i > 0) {
                  let temp = blocks[i];
                  blocks[i] = blocks[i - 1];
                  blocks[i - 1] = temp;
                }
              } else if (action === "movedown") {
                if (i < blocks.length - 1) {
                  let temp = blocks[i];
                  blocks[i] = blocks[i + 1];
                  blocks[i + 1] = temp;
                }
              } else if (action === "delete") {
                blocks.splice(i, 1);
                if (activeId === id)
                  activeId =
                    blocks[Math.min(i, blocks.length - 1)]?.id || null;
                toast("Line deleted");
              }
              bumpBlocks();
              save();
              render();
              close();
            }
          };
        }
        function insertLinesBelow(id) {
          const i = blocks.findIndex((x) => x.id === id);
          $("#overlay").innerHTML =
            `<div class="modal-backdrop"><form class="modal"><strong>Insert lines below</strong><textarea id="insertArea" dir="auto" placeholder="One line per block"></textarea><div class="modal-actions"><button type="button" data-close>Cancel</button><button class="primary">Insert</button></div></form></div>`;
          const ta = $("#insertArea");
          ta.focus();
          const close = () => {
            $("#overlay").innerHTML = "";
            checkResume();
          };
          $(".modal-backdrop").onclick = (e) => {
            if (e.target === e.currentTarget) close();
          };
          $("form.modal").onsubmit = (e) => {
            e.preventDefault();
            let lines = ta.value.split("\n").map((s) => s.trim());
            while (lines.length && lines[0] === "") lines.shift();
            while (lines.length && lines[lines.length - 1] === "") lines.pop();
            // Empty input (or only blank lines) -> exactly one blank line
            if (!lines.length) lines = [""];
            blocks.splice(
              i + 1,
              0,
              ...lines.map((t) => ({ id: ids(), text: t, timestamp: null })),
            );
            bumpBlocks();
            save();
            render();
            close();
          };
          $("[data-close]").onclick = close;
        }
        /* ============== Multi-select (long-press) ============== */
        function enterSelMode() {
          if (selMode) return;
          selMode = true;
          selIds.clear();
          $("#selbar").classList.remove("hidden");
          render();
        }
        function exitSelMode() {
          if (!selMode) return;
          selMode = false;
          selIds.clear();
          $("#selbar").classList.add("hidden");
          render();
        }
        function updateSelbar() {
          $("#selCount").textContent = selIds.size + " selected";
          $("#selPaste").classList.toggle("hidden", clip.length === 0);
        }
        function selectedBlocks() {
          return blocks.filter((b) => selIds.has(b.id));
        }
        function doCopy() {
          const sel = selectedBlocks();
          if (!sel.length) return;
          clip = sel.map((b) => b.text); // text only, no timestamps
          toast(
            "Copied " + sel.length + (sel.length === 1 ? " line" : " lines"),
          );
          exitSelMode();
        }
        function doCut() {
          const sel = selectedBlocks();
          if (!sel.length) return;
          clip = sel.map((b) => b.text);
          const n = sel.length;
          blocks = blocks.filter((b) => !selIds.has(b.id));
          if (activeId && selIds.has(activeId))
            activeId = blocks[0]?.id || null;
          bumpBlocks();
          save();
          toast("Cut " + n + (n === 1 ? " line" : " lines"));
          exitSelMode();
        }
        /* Duplicate the selection right after the last selected line
           (text only, one step — no clipboard involved) */
        function doCopyBelow() {
          const sel = selectedBlocks();
          if (!sel.length) return;
          const idxs = blocks
            .map((b, i) => (selIds.has(b.id) ? i : -1))
            .filter((i) => i >= 0);
          const at = Math.max(...idxs) + 1;
          blocks.splice(
            at,
            0,
            ...sel.map((b) => ({ id: ids(), text: b.text, timestamp: null })),
          );
          bumpBlocks();
          save();
          render();
          toast(
            "Copied " + sel.length + (sel.length === 1 ? " line" : " lines") + " below",
          );
          exitSelMode();
        }
        function doDeleteSel() {
          const n = selIds.size;
          if (!n) return;
          blocks = blocks.filter((b) => !selIds.has(b.id));
          if (activeId && selIds.has(activeId))
            activeId = blocks[0]?.id || null;
          bumpBlocks();
          save();
          toast("Deleted " + n + (n === 1 ? " line" : " lines"));
          exitSelMode();
        }
        function pasteAfterSelected() {
          const idxs = blocks
            .map((b, i) => (selIds.has(b.id) ? i : -1))
            .filter((i) => i >= 0);
          if (!idxs.length) return;
          const at = Math.max(...idxs) + 1;
          blocks.splice(
            at,
            0,
            ...clip.map((t) => ({ id: ids(), text: t, timestamp: null })),
          );
          bumpBlocks();
          save();
          toast("Pasted " + clip.length + (clip.length === 1 ? " line" : " lines"));
          clip = []; // consumed; "Paste after" disappears again
          exitSelMode();
        }
        /* ============== Toast + clipboard helpers ============== */
        let toastTimer = 0;
        function toast(msg) {
          let t = document.querySelector(".toast");
          if (!t) {
            t = document.createElement("div");
            t.className = "toast";
            document.body.appendChild(t);
          }
          t.textContent = msg;
          requestAnimationFrame(() => t.classList.add("show"));
          clearTimeout(toastTimer);
          toastTimer = setTimeout(() => t.classList.remove("show"), 1500);
        }
        async function copyText(text) {
          try {
            await navigator.clipboard.writeText(text);
            return true;
          } catch (e) {
            try {
              const ta = document.createElement("textarea");
              ta.value = text;
              ta.style.position = "fixed";
              ta.style.opacity = "0";
              document.body.appendChild(ta);
              ta.select();
              const ok = document.execCommand("copy");
              ta.remove();
              return ok;
            } catch (e2) {
              return false;
            }
          }
        }
        function editText(id) {
          let b = blocks.find((x) => x.id === id);
          $("#overlay").innerHTML =
            `<div class="modal-backdrop"><form class="modal"><strong>Edit line</strong><input id="editLine" dir="auto" value="${escapeHTML(b.text)}" autocomplete="off"><div class="modal-actions"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form></div>`;
          let inp = $("#editLine");
          inp.focus();
          // Caret at the end — selecting the whole line fights the edit.
          inp.setSelectionRange(inp.value.length, inp.value.length);
          $(".modal-backdrop").onclick = (e) => {
            if (e.target === e.currentTarget) {
              $("#overlay").innerHTML = "";
              checkResume();
            }
          };
          $("form.modal").onsubmit = (e) => {
            e.preventDefault();
            change(id, (x) => (x.text = inp.value));
            $("#overlay").innerHTML = "";
            checkResume();
          };
          $("[data-close]").onclick = () => {
            $("#overlay").innerHTML = "";
            checkResume();
          };
        }
        function editTime(id) {
          let b = blocks.find((x) => x.id === id),
            initial =
              b.timestamp == null ? "" : (b.timestamp / 1000).toFixed(2);
          $("#overlay").innerHTML =
            `<div class="modal-backdrop"><form class="modal"><strong>Timestamp (seconds)</strong><input id="editTime" type="number" min="0" step="0.01" inputmode="decimal" value="${initial}" placeholder="e.g. 83.45"><div class="modal-actions"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form></div>`;
          let inp = $("#editTime");
          inp.focus();
          $(".modal-backdrop").onclick = (e) => {
            if (e.target === e.currentTarget) $("#overlay").innerHTML = "";
          };
          $("form.modal").onsubmit = (e) => {
            e.preventDefault();
            let v = inp.value.trim();
            change(
              id,
              (x) =>
                (x.timestamp =
                  v === "" ? null : Math.max(0, Math.round(Number(v) * 1000))),
            );
            $("#overlay").innerHTML = "";
          };
          $("[data-close]").onclick = () => ($("#overlay").innerHTML = "");
        }
        function checkResume() {
          if (pendingResume && ws && !ws.isPlaying() && $("#overlay").innerHTML === "") {
            ws.play();
            pendingResume = false;
          }
        }
        $("#lyricsList").addEventListener("click", (e) => {
          if (Date.now() < suppressClick) return;
          if (selMode) {
            // In selection mode a tap toggles the block's selection
            const block = e.target.closest(".block");
            if (!block) return;
            const bid = block.dataset.id;
            if (selIds.has(bid)) selIds.delete(bid);
            else selIds.add(bid);
            if (selIds.size === 0) {
              exitSelMode();
              return;
            }
            updateSelbar();
            render();
            return;
          }
          let block = e.target.closest(".block");
          if (!block) return;
          let id = block.dataset.id,
            act = e.target.dataset.act;
          if (act === "plus")
            change(
              id,
              (b) =>
                (b.timestamp = Math.max(0, (b.timestamp ?? getTime()) + 100)),
            );
          else if (act === "minus")
            change(
              id,
              (b) =>
                (b.timestamp = Math.max(0, (b.timestamp ?? getTime()) - 100)),
            );
          else if (act === "time") editTime(id);
          else if (act === "stamp") stamp(id);
          else if (act === "from") {
            let b = blocks.find((x) => x.id === id);
            if (b.timestamp != null) {
              ws.setTime(Math.max(0, b.timestamp) / 1000);
              ws.play();
            }
          } else if (act === "more") showSheet(id);
          else if (act === "select") select(id, true, false);
        });
        /* Long-press on a line enters multi-select mode; tap to toggle. */
        let lpTimer = 0,
          lpId = null;
        (() => {
          const list = $("#lyricsList");
          list.addEventListener("pointerdown", (e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            const block = e.target.closest(".block");
            if (!block || e.target.closest("button")) return;
            lpId = block.dataset.id;
            const x0 = e.clientX,
              y0 = e.clientY;
            clearTimeout(lpTimer);
            lpTimer = setTimeout(() => {
              lpTimer = 0;
              if (!selMode) enterSelMode();
              if (lpId && !selIds.has(lpId)) selIds.add(lpId);
              updateSelbar();
              render();
              suppressClick = Date.now() + 600;
              try {
                navigator.vibrate && navigator.vibrate(15);
              } catch (err) {}
            }, 450);
            const onMove = (ev) => {
              if (lpTimer && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 12) {
                clearTimeout(lpTimer);
                lpTimer = 0;
              }
            };
            const onEnd = () => {
              clearTimeout(lpTimer);
              lpTimer = 0;
              list.removeEventListener("pointermove", onMove);
              list.removeEventListener("pointerup", onEnd);
              list.removeEventListener("pointercancel", onEnd);
            };
            list.addEventListener("pointermove", onMove);
            list.addEventListener("pointerup", onEnd);
            list.addEventListener("pointercancel", onEnd);
          });
        })();
        $("#selCopy").onclick = () => doCopy();
        $("#selCut").onclick = () => doCut();
        $("#selCopyBelow").onclick = () => doCopyBelow();
        $("#selDelete").onclick = () => doDeleteSel();
        $("#selPaste").onclick = () => pasteAfterSelected();
        $("#selCancel").onclick = () => exitSelMode();

        $("#playBtn").onclick = () => ws?.playPause();
        $("#back2").onclick = () =>
          ws && ws.setTime(Math.max(0, ws.getCurrentTime() - 2));
        $("#forward2").onclick = () =>
          ws && ws.setTime(Math.min(ws.getDuration(), ws.getCurrentTime() + 2));
        $("#speedSlider").oninput = (e) => {
          speed = +e.target.value;
          $("#speedLabel").textContent = speed.toFixed(2) + "×";
          if (ws) ws.setPlaybackRate(speed);
          zoom = Math.round(80 / speed);
          if (ws) ws.zoom(zoom);
          save();
        };
        $("#exportBtn").onclick = () => showExportDialog();
        /* Builds the LRC file content: metadata header (only filled fields)
           + stamped lines sorted by time. Empty lyrics become a space so
           picky players don't drop the line. */
        function buildLrc(m) {
          const stamped = getStamped().slice().sort((a, b) => a.timestamp - b.timestamp);
          if (!stamped.length) return "";
          const header = [];
          const add = (tag, v) => {
            v = (v || "").trim();
            if (v) header.push("[" + tag + ": " + v + "]");
          };
          add("ti", m.ti);
          add("ar", m.ar);
          add("al", m.al);
          add("au", m.au);
          add("by", m.by);
          const body = stamped
            .map((b) => fmt(b.timestamp) + " " + (b.text === "" ? " " : b.text))
            .join("\n");
          return (header.length ? header.join("\n") + "\n\n" : "") + body;
        }
        function readExportMeta() {
          const g = (s) => (s ? $("#" + s).value : "");
          return {
            ti: g("exTi"),
            ar: g("exAr"),
            al: g("exAl"),
            au: g("exAu"),
            by: g("exBy"),
          };
        }
        function showExportDialog() {
          if (!getStamped().length) {
            toast("No timestamps to export.");
            return;
          }
          const defaultTitle = (audioName || "lyrics").replace(/\.[^.]+$/, "");
          $("#overlay").innerHTML =
            `<div class="modal-backdrop"><form class="modal" id="exportForm">
            <strong>Export .lrc</strong>
            <label>Title<input id="exTi" dir="auto" value="${escapeHTML(meta.ti || defaultTitle)}"></label>
            <label>Artist<input id="exAr" dir="auto" value="${escapeHTML(meta.ar)}"></label>
            <label>Album<input id="exAl" dir="auto" value="${escapeHTML(meta.al)}"></label>
            <label>Composer<input id="exAu" dir="auto" value="${escapeHTML(meta.au)}"></label>
            <label>Creator<input id="exBy" dir="auto" value="${escapeHTML(meta.by)}"></label>
            <div class="modal-actions">
              <button type="button" data-close>Cancel</button>
              <button type="button" id="exCopy">Copy</button>
              <button type="submit" class="primary">Save</button>
            </div>
          </form></div>`;
          $("#overlay .modal-backdrop").onclick = (e) => {
            if (e.target === e.currentTarget) closeOverlay();
          };
          $("#exportForm [data-close]").onclick = closeOverlay;
          $("#exCopy").onclick = async () => {
            const ok = await copyText(buildLrc(readExportMeta()));
            toast(ok ? "LRC copied to clipboard" : "Copy failed");
          };
          $("#exportForm").onsubmit = (e) => {
            e.preventDefault();
            const content = buildLrc(readExportMeta());
            closeOverlay();
            doExportSave(content);
          };
        }
        async function doExportSave(content) {
          const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
          const Filesystem = plugins.Filesystem;
          const fileName = (audioName || "lyrics").replace(/\.[^.]+$/, "") + ".lrc";
          if (Filesystem && typeof Filesystem.writeFile === "function") {
            try {
              await Filesystem.writeFile({
                path: fileName,
                data: content,
                directory: "EXTERNAL", // plain string, not an enum
                encoding: "utf8",      // not "utf-8"
              });
              const Share = plugins.Share;
              if (Share && typeof Share.share === "function") {
                const uriResult = await Filesystem.getUri({
                  path: fileName,
                  directory: "EXTERNAL",
                });
                await Share.share({
                  title: "Export LRC",
                  text: "Here is your LRC file.",
                  files: [uriResult.uri], // array of file URIs, not `url`
                  dialogTitle: "Share LRC file",
                });
              } else {
                toast("File saved to app folder. (Share plugin not available)");
              }
            } catch (err) {
              toast("Export failed: " + (err && err.message ? err.message : err));
            }
          } else {
            // Fallback for web (original download approach)
            const a = document.createElement("a");
            a.href = URL.createObjectURL(
              new Blob([content], { type: "text/plain;charset=utf-8" }),
            );
            a.download = fileName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 500);
            toast("Downloaded " + fileName);
          }
        }
        $("#textInput").onchange = (e) => {
          let f = e.target.files[0];
          if (!f) return;
          let r = new FileReader();
          r.onload = () => {
            // Put the raw file content into the textarea (including timestamps)
            // `makeBlocks` will parse them when "Start syncing" is clicked
            $("#lyricsInput").value = r.result;
          };
          r.readAsText(f, "UTF-8");
        };
        $("#beginBtn").onclick = () => {
          let f = $("#audioInput").files[0];
          if (!f) {
            $("#startNotice").textContent = "Choose an audio file first.";
            return;
          }
          const parsed = parseLrc($("#lyricsInput").value);
          if (!parsed.blocks.length) {
            $("#startNotice").textContent = "Add some lyrics first.";
            return;
          }
          let newBlocks = parsed.blocks;
          // New (unstamped) lyrics: pad with a blank line at top and bottom.
          // Left unstamped, so they stay out of the export unless the user sets them.
          if (!newBlocks.some((b) => b.timestamp != null)) {
            const blank = () => ({ id: ids(), text: "", timestamp: null });
            if (newBlocks[0].text.trim() !== "") newBlocks = [blank(), ...newBlocks];
            if (newBlocks[newBlocks.length - 1].text.trim() !== "")
              newBlocks = [...newBlocks, blank()];
          }
          blocks = newBlocks;
          meta = parsed.meta;
          bumpBlocks();
          activeId = blocks[0]?.id || null;
          audioName = f.name;
          let r = new FileReader();
          r.onload = () => {
            audioData = r.result;
            speed = 1;
            zoom = 80;
            save();
            setScreen(true);
            waveInit(audioData);
            render();
            extractAudioMeta(f);
          };
          r.readAsDataURL(f);
        };
        /* Fill any empty metadata fields from the audio file's own tags
           (ID3v1/v2, MP4, FLAC, OGG...). Tags already present in the LRC
           text win. Fails silently if the CDN library is unavailable. */
        function extractAudioMeta(file) {
          if (typeof jsmediatags === "undefined") return;
          // Unwraps a tag value: string | { data } | array of those
          const str = (v) => {
            if (v == null) return "";
            if (typeof v === "string") return v.trim();
            if (Array.isArray(v)) return str(v[0]);
            if (typeof v === "object") return str(v.data);
            return String(v).trim();
          };
          try {
            jsmediatags.read(file, {
              onSuccess: (res) => {
                const t = (res && res.tags) || {};
                let filled = false;
                const fill = (key, val) => {
                  val = str(val);
                  if (val && !meta[key]) {
                    meta[key] = val;
                    filled = true;
                  }
                };
                fill("ti", t.title);
                fill("ar", t.artist);
                fill("al", t.album);
                // composer is not a jsmediatags shortcut; read the raw frame
                fill("au", t.TCOM || t["©wrt"]);
                if (filled) {
                  save();
                  toast("Loaded metadata from the audio file");
                }
              },
              onError: () => {},
            });
          } catch (e) {
            console.warn("Metadata extraction failed", e);
          }
        }
        // ============== Back-button confirmation (app + web) ==============
        // Capacitor 6 bridge injects a method-only proxy per installed
        // plugin at window.Capacitor.Plugins.<Name> — never destructure
        // enums from it (see export fix). The App plugin's proxy provides
        // addListener() and exitApp().
        const isNative = !!(
          window.Capacitor &&
          window.Capacitor.Plugins &&
          window.Capacitor.Plugins.App
        );

        function closeOverlay() {
          const overlay = $("#overlay");
          if (overlay.innerHTML.trim() === "") return;
          // If the back button closes the "..." menu directly, mirror the
          // sheet's own close() so audio paused by the menu resumes instead
          // of staying paused forever (b633e02 pause-on-menu feature).
          if (overlay.innerHTML.includes("sheet-backdrop")) {
            pendingResume = wasPlaying;
          }
          overlay.innerHTML = "";
          checkResume();
        }
        function pushSyncHistory() {
          try {
            history.pushState({ lyricSync: true }, "");
            syncHistoryPushed = true;
          } catch (e) {
            // Some browsers forbid pushState on file:// origins.
          }
        }
        function showConfirmDialog(
          title,
          message,
          confirmLabel,
          isDestructive,
          onConfirm,
        ) {
          const overlay = $("#overlay");
          overlay.innerHTML =
            `<div class="modal-backdrop">
              <div class="modal">
                <strong>${escapeHTML(title)}</strong>
                <p>${escapeHTML(message)}</p>
                <div class="modal-actions">
                  <button type="button" data-close>Cancel</button>
                  <button type="button" class="primary${
                    isDestructive ? " danger" : ""
                  }" data-confirm>${escapeHTML(confirmLabel)}</button>
                </div>
              </div>
            </div>`;
          const backdrop = overlay.querySelector(".modal-backdrop");
          backdrop.onclick = (e) => {
            if (e.target === e.currentTarget) closeOverlay();
          };
          overlay.querySelector("[data-close]").onclick = closeOverlay;
          overlay.querySelector("[data-confirm]").onclick = () => {
            closeOverlay();
            if (typeof onConfirm === "function") onConfirm();
          };
          return overlay;
        }
        function saveTimestampsToInput() {
          // Serialize the current blocks back into the lyrics textarea.
          // parseLrc() re-parses timestamps (and header tags) on the next
          // start, so no synced work is lost when returning to the main screen.
          const header = [];
          const add = (tag, v) => {
            v = (v || "").trim();
            if (v) header.push("[" + tag + ": " + v + "]");
          };
          add("ti", meta.ti);
          add("ar", meta.ar);
          add("al", meta.al);
          add("au", meta.au);
          add("by", meta.by);
          const body = blocks
            .map((b) =>
              b.timestamp != null ? fmt(b.timestamp) + " " + b.text : b.text,
            )
            .join("\n");
          $("#lyricsInput").value =
            (header.length ? header.join("\n") + "\n" : "") + body;
        }
        function returnToMain() {
          ws?.pause();
          saveTimestampsToInput();
          wasPlaying = false;
          pendingResume = false;
          setScreen(false);
        }
        function handleBack() {
          // Native (Android) hardware back button.
          if (selMode) {
            exitSelMode();
            return;
          }
          const overlay = $("#overlay");
          if (overlay && overlay.innerHTML.trim() !== "") {
            closeOverlay(); // sheet / edit modal / dialog: back acts as Cancel
            return;
          }
          const onSync = !$("#syncScreen").classList.contains("hidden");
          if (onSync) {
            showConfirmDialog(
              "Return to main?",
              "Your progress will be saved.",
              "Return",
              false,
              returnToMain,
            );
          } else {
            showConfirmDialog(
              "Exit?",
              "Are you sure you want to exit?",
              "Exit",
              true,
              () => {
                const app =
                  window.Capacitor &&
                  window.Capacitor.Plugins &&
                  window.Capacitor.Plugins.App;
                if (app && typeof app.exitApp === "function") {
                  try {
                    app.exitApp();
                  } catch (e) {}
                }
              },
            );
          }
        }
        function handlePopState() {
          // Web browser back button.
          if (isNative) return;
          const overlay = $("#overlay");
          const onSync = !$("#syncScreen").classList.contains("hidden");
          if (selMode && onSync) {
            exitSelMode();
            pushSyncHistory();
            return;
          }
          if (overlay && overlay.innerHTML.trim() !== "") {
            closeOverlay(); // back while dialog open = Cancel
            if (onSync) pushSyncHistory(); // keep one dummy so back still works
            return;
          }
          if (!onSync) return; // start screen: let the browser navigate away
          showConfirmDialog(
            "Return to main?",
            "Your progress will be saved.",
            "Return",
            false,
            () => {
              returnToMain();
              // This popstate already consumed the previous dummy, and a
              // fresh one was pushed when the dialog opened. Pop that one
              // so history is clean — it is a same-document entry, so no
              // real navigation happens.
              try {
                history.back();
              } catch (e) {}
            },
          );
          pushSyncHistory(); // guard the real entry while the dialog is open
        }
        function registerBackHandling() {
          const app =
            window.Capacitor &&
            window.Capacitor.Plugins &&
            window.Capacitor.Plugins.App;
          if (app && typeof app.addListener === "function") {
            app.addListener("backButton", handleBack);
            return;
          }
          if (!isNative) {
            window.addEventListener("popstate", handlePopState);
            return;
          }
          console.warn(
            "Capacitor App plugin found but addListener missing; back button not intercepted",
          );
        }

        function addPinch() {
          let el = $("#waveform");
          el.addEventListener(
            "touchstart",
            (e) => {
              if (e.touches.length === 2) {
                pinch = {
                  distance: Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY,
                  ),
                  zoom,
                };
              }
            },
            { passive: true },
          );
          el.addEventListener(
            "touchmove",
            (e) => {
              if (!pinch || e.touches.length !== 2) return;
              let d = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY,
              );
              zoom = Math.max(
                15,
                Math.min(500, (pinch.zoom * d) / pinch.distance),
              );
              ws?.zoom(zoom);
              save();
            },
            { passive: true },
          );
          el.addEventListener(
            "touchend",
            (e) => {
              if (e.touches.length < 2) pinch = null;
            },
            { passive: true },
          );
        }
        addPinch();
        try {
          let saved = JSON.parse(localStorage.getItem(storeKey) || "null");
          if (saved?.audioData && Array.isArray(saved.blocks)) {
            ({ blocks, speed, zoom, audioName, audioData } = saved);
            meta =
              saved.meta && typeof saved.meta === "object"
                ? { ...defaultMeta(), ...saved.meta }
                : defaultMeta();
            blocks = blocks.map((b) => ({
              id: b.id || ids(),
              text: String(b.text ?? ""),
              timestamp: Number.isFinite(b.timestamp) ? b.timestamp : null,
            }));
            activeId = blocks[0]?.id || null;
            bumpBlocks();
            $("#speedSlider").value = speed;
            $("#speedLabel").textContent = speed.toFixed(2) + "×";
            setScreen(true);
            render();
            waveInit(audioData);
          }
        } catch (e) {
          console.warn("No usable saved session", e);
        }
        registerBackHandling();

        // PWA: register the service worker on the web. Skipped inside the
        // native shell (Capacitor serves the app itself; a stale SW cache
        // on the capacitor:// origin can shadow app updates) and on
        // file:// (the single-file build has no sw.js next to it anyway).
        if (
          !isNative &&
          (location.protocol === "https:" || location.protocol === "http:") &&
          "serviceWorker" in navigator
        ) {
          window.addEventListener("load", () => {
            navigator.serviceWorker.register("sw.js").catch(() => {});
          });
        }

        // Small debug/test hook (also handy in DevTools)
        window.LyricSync = {
          parseLrc,
          buildLrc,
          player: () => ws,
          getState: () => ({
            blocks,
            clip: clip.slice(),
            selMode,
            meta: { ...meta },
            audioName,
          }),
        };
      })();
    