/* Guided judge-demo tour. Self-contained: it only reads the DOM and never touches app state.
   It starts for judge-sandbox sessions, highlights the next thing to click, and advances
   automatically when it sees the app reach the expected screen. */
(() => {
  const KEY = "ll_tour";
  const store = {
    get() { try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch { return {}; } },
    set(v) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const $ = (s, r = document) => r.querySelector(s);
  const crumb = () => ($(".crumb")?.textContent || "").trim();
  const onScreen = (name) => crumb().endsWith(name);
  const inLecture = () => crumb().includes("›");

  const STEPS = [
    {
      title: "Welcome to LectureLens AI",
      body: "This 60-second tour shows the main idea: when you get a question wrong, LectureLens AI explains why and links you to the exact lecture passage. You are in a private sandbox, so nothing here is visible to anyone else.",
      manual: true,
    },
    {
      title: "Open a lecture",
      body: "Open the Operating Systems lesson. Its notes, slides and quiz questions are all linked back to the lecture text.",
      target: () => {
        const row = [...document.querySelectorAll("[data-open]")].find((b) => /operating systems/i.test(b.closest("article")?.textContent || ""));
        return row || $("[data-open]");
      },
      done: inLecture,
    },
    {
      title: "Go to Quizzes",
      body: "Open the Quizzes page from the menu.",
      target: () => $('#nav button[data-v="quiz"]'),
      done: () => onScreen("Quizzes"),
    },
    {
      title: "Take the quiz, and get one wrong on purpose",
      body: "Answer all the questions and deliberately pick at least one wrong answer, so you can see the explainer in action.",
      target: () => $(".quiz-options") || $(".quiz-question"),
      done: () => !!$(".quiz-result"),
    },
    {
      title: "Ask why you were wrong",
      body: "Press \u201cExplain why I got this wrong\u201d on a missed question. (If you got everything right, press Restart and choose a wrong answer.)",
      target: () => $(".whywrong-trigger") || $("#rt"),
      done: () => !!$(".whywrong-panel"),
    },
    {
      title: "Check the evidence",
      body: "The explanation compares your answer with the lecture-supported one and shows the transcript passage it is based on. Use the source button to jump to that moment in the lecture. When you have looked, press Next.",
      target: () => $(".whywrong-evidence") || $(".whywrong-panel"),
      manual: true,
    },
    {
      title: "See what to revise",
      body: "Open Revision Radar. It turns your answers into a priority list of topics to revise. In this sandbox the earlier activity is illustrative demo data.",
      target: () => $('#nav button[data-v="radar"]'),
      done: () => onScreen("Revision Radar"),
    },
    {
      title: "That's the loop",
      body: "Wrong answer \u2192 explanation \u2192 lecture evidence \u2192 revision plan. Create a free account to upload your own lectures and slides. You can replay this tour anytime.",
      manual: true,
      last: true,
    },
  ];

  let state = { i: 0, closed: false, finished: false, ...store.get() };
  let card, launcher, lastTarget, raf = 0, advancing = false;

  function save() { store.set(state); }
  const isDemoSession = () => !!(window.LL_USER && window.LL_USER.isDemo) && getComputedStyle($(".app") || document.body).display !== "none";

  function clearTarget() {
    document.querySelectorAll(".tour-target").forEach((n) => n.classList.remove("tour-target"));
    lastTarget = null;
  }

  function buildCard() {
    card = document.createElement("section");
    card.className = "tour-card";
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", "Guided demo tour");
    card.setAttribute("aria-live", "polite");
    card.innerHTML = '<div class="tour-head"><span class="tour-step"></span><button type="button" class="tour-close" aria-label="Close tour">\u00d7</button></div><h3 class="tour-title"></h3><p class="tour-body"></p><div class="tour-actions"><button type="button" class="tour-skip">Skip tour</button><button type="button" class="tour-next"></button></div><div class="tour-bar" aria-hidden="true"><i></i></div>';
    document.body.appendChild(card);
    card.querySelector(".tour-close").addEventListener("click", () => close(false));
    card.querySelector(".tour-skip").addEventListener("click", () => close(false));
    card.querySelector(".tour-next").addEventListener("click", () => (STEPS[state.i].last ? close(true) : go(state.i + 1)));
  }

  function buildLauncher() {
    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "tour-launcher";
    launcher.textContent = "\u2726 Take the tour";
    launcher.addEventListener("click", () => { state = { i: 0, closed: false, finished: false }; save(); show(); });
    document.body.appendChild(launcher);
  }

  function renderCard() {
    const step = STEPS[state.i];
    card.querySelector(".tour-step").textContent = `Step ${state.i + 1} of ${STEPS.length}`;
    card.querySelector(".tour-title").textContent = step.title;
    card.querySelector(".tour-body").textContent = step.body;
    const next = card.querySelector(".tour-next");
    next.textContent = step.last ? "Finish" : step.manual ? "Next \u2192" : "Skip step";
    next.classList.toggle("tour-next-quiet", !step.manual && !step.last);
    card.querySelector(".tour-skip").hidden = !!step.last;
    card.querySelector(".tour-bar i").style.width = `${Math.round(((state.i + 1) / STEPS.length) * 100)}%`;
  }

  function go(i) {
    state.i = Math.max(0, Math.min(STEPS.length - 1, i));
    save();
    advancing = false;
    renderCard();
    clearTarget();
    tick();
  }

  function close(finished) {
    state.closed = true; state.finished = !!finished; save();
    card.hidden = true; clearTarget();
    launcher.hidden = false;
  }

  function show() {
    card.hidden = false; launcher.hidden = true; renderCard(); tick();
  }

  function tick() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!card || card.hidden) return;
      const step = STEPS[state.i];
      if (!step.manual && step.done && step.done() && !advancing) {
        advancing = true;
        setTimeout(() => { if (!card.hidden && STEPS[state.i] === step) go(state.i + 1); }, 450);
        return;
      }
      const el = step.target && step.target();
      if (el && el !== lastTarget) {
        clearTarget();
        el.classList.add("tour-target");
        lastTarget = el;
        const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
        try { el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }); } catch { /* old browser */ }
      } else if (!el && lastTarget) {
        clearTarget();
      }
    });
  }

  function start() {
    if (card) return;
    buildCard(); buildLauncher();
    new MutationObserver((muts) => {
      if (muts.every((m) => card.contains(m.target) || launcher.contains(m.target))) return;
      tick();
    }).observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !card.hidden) close(false); });
    if (state.closed) { card.hidden = true; launcher.hidden = false; } else { show(); }
  }

  let tries = 0;
  const wait = setInterval(() => {
    if (isDemoSession()) { clearInterval(wait); start(); }
    else if (++tries > 40) clearInterval(wait);
  }, 300);
  window.addEventListener("ll-authenticated", () => { if (isDemoSession() && !card) start(); });
})();
