// AetherDeck Room spike (Firefox chrome script). Puts real <browser> elements (not iframes) on a ring in CSS 3D over the
// whole browser window. Question it answers: do clicks, typing and sign-in work inside tilted real browser elements?
// The ring maths is the same as chromium/src/roomLogic.ts (shared/surround.ts layout), written out here in plain JS.
(function () {
  const XHTML = "http://www.w3.org/1999/xhtml";
  const PW = 1100, PH = Math.round(1100 / 1.45), TAU = Math.PI * 2;
  const URLS = (Services.env.get("AD_ROOM_URLS") || "https://github.com,https://www.pinterest.com,https://mail.google.com").split(",");
  const log = (m) => window.dump("[room] " + m + "\n");
  const turn = (a) => { const t = (a + Math.PI) % TAU; return (t < 0 ? t + TAU : t) - Math.PI; };

  function ring(n) {
    const w0 = 0.72 * 1.45, gap = 0.07;
    const s = Math.min(1, TAU / (n * (w0 + gap)));
    const w = w0 * s;
    let at = -w / 2;
    const yaws = [];
    for (let i = 0; i < n; i++) { yaws.push(turn(at + w / 2)); at += w + gap * s; }
    return { yaws, radius: PW / (2 * Math.tan(w / 2)) };
  }

  const h = (tag, css, cls) => { const e = document.createElementNS(XHTML, tag); if (css) e.style.cssText = css; if (cls) e.className = cls; return e; };
  const root = h("div", "position:fixed;inset:0;z-index:2147483000;background:radial-gradient(ellipse at 50% 40%,#14141c,#07070a 70%);overflow:hidden;perspective-origin:50% 50%");
  root.id = "ad-room";
  const world = h("div", "position:absolute;left:50%;top:50%;width:0;height:0;transform-style:preserve-3d");
  root.append(world);
  const bar = h("div", "position:absolute;top:0;left:0;right:0;height:34px;display:flex;gap:8px;align-items:center;padding:0 12px;color:#ececf1;font:13px system-ui;z-index:5;background:#0b0b0fcc");
  bar.textContent = "AetherDeck Room (Firefox spike): ← → turn, 0 show all, Esc or the button to leave";
  const leaveBtn = h("button", "margin-left:auto;margin-right:12px;padding:2px 10px;border:1px solid #555;border-radius:6px;background:#222;color:#fff;font:12px system-ui;cursor:pointer");
  leaveBtn.textContent = "Leave the Room (Esc)";
  bar.append(leaveBtn);
  const leave = () => { root.hidden = !root.hidden; };
  leaveBtn.addEventListener("click", leave);
  root.append(bar);
  document.documentElement.append(root);

  const cam = { yaw: 0, fov: 1.08, back: 0 };
  const panes = [];
  let layout = ring(URLS.length);

  function apply() {
    const H = root.clientHeight || 800;
    const P = (H / 2) / Math.tan(cam.fov / 2);
    root.style.perspective = P + "px";
    world.style.transform = `translateZ(${P - cam.back}px) rotateY(${cam.yaw}rad)`;
  }

  function addPane(url, i) {
    const pane = h("div", `position:absolute;left:0;top:0;width:${PW}px;height:${PH}px;margin:${-PH / 2}px 0 0 ${-PW / 2}px;display:flex;flex-direction:column;background:#fff;border:1px solid #333;border-radius:8px;overflow:hidden;backface-visibility:hidden`);
    const head = h("div", "flex:0 0 26px;background:#15151b;color:#ececf1;font:12px system-ui;display:flex;align-items:center;padding:0 8px");
    head.textContent = url;
    const b = document.createXULElement("browser");
    b.setAttribute("type", "content");
    b.setAttribute("remote", "true");
    b.setAttribute("maychangeremoteness", "true");
    b.setAttribute("disablehistory", "true");
    b.setAttribute("nodefaultsrc", "true");
    b.style.cssText = "flex:1;min-height:0;width:100%";
    pane.append(head, b);
    world.append(pane);
    const p = { pane, b, url, i };
    panes.push(p);
    return p;
  }

  function place() {
    layout = ring(panes.length);
    panes.forEach((p, i) => { p.yaw = layout.yaws[i]; p.pane.style.transform = `rotateY(${-p.yaw}rad) translateZ(${-layout.radius}px)`; });
    apply();
  }

  URLS.forEach((u, i) => addPane(u, i));
  place();
  // The browser elements must be in the document before they are given an address.
  for (const p of panes) {
    try { p.b.fixupAndLoadURIString(p.url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); }
    catch (e) { log("load " + p.url + " failed: " + e); }
  }

  function lookAt(i) { cam.yaw = panes[i].yaw; apply(); }
  function overview(on) { cam.back = on ? layout.radius * 0.85 : 0; cam.fov = on ? 1.5 : 1.08; apply(); }
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const cur = panes.findIndex((p) => Math.abs(turn(p.yaw - cam.yaw)) < 0.01);
      const n = (Math.max(0, cur) + (e.key === "ArrowRight" ? 1 : -1) + panes.length) % panes.length;
      lookAt(n);
    } else if (e.key === "0") overview(cam.back === 0);
    else if ((e.code === "KeyR" && e.altKey) || e.key === "Escape") leave();
  });
  window.addEventListener("resize", apply);
  window.adRoom = { cam, panes, lookAt, overview, apply, root, world, layout: () => layout, PW, PH };
  log("room built with " + panes.length + " panes");
})();
