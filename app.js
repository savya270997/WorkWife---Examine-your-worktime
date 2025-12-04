/* app.js — corrected full file
   Overwrite /mnt/data/app.js with this content (no fragments)
*/

(() => {
  const KEY_CONFIG = "workTrackerConfig";
  const KEY_LOGS = "workTrackerDailyLogs";
  const PAGE_SIZE = 10;

  // --- storage helpers
  function saveConfig(cfg) {
    cfg.updatedAt = new Date().toISOString();
    localStorage.setItem(KEY_CONFIG, JSON.stringify(cfg));
  }
  function loadConfig() {
    const raw = localStorage.getItem(KEY_CONFIG);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  function saveLogs(arr) {
    localStorage.setItem(KEY_LOGS, JSON.stringify(arr));
  }
  function loadLogs() {
    const raw = localStorage.getItem(KEY_LOGS);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }

  // --- defaults
  const DEFAULT_CONFIG = {
    mandatoryDaysPerWeek: 3,
    allowedWFHPerMonth: 0,
    mandatoryHoursPerDay: 9,
    saturdayOff: true,
    sundayOff: true,
    updatedAt: new Date().toISOString(),
  };

  // --- utilities
  const pad = (n) => String(n).padStart(2, "0");
  function formatDateISO(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseISO(s) {
    const [y, m, d] = (s || "").split("-").map(Number);
    if (!y) return null;
    return new Date(y, m - 1, d);
  }
  function uid() {
    return Math.random().toString(36).slice(2, 9);
  }
  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }
  function formatTimeShort(isoOrDate) {
    if (!isoOrDate) return "—";
    const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
    if (isNaN(d)) return "—";
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function localDateTimeFromParts(dateISO, timeHHMM) {
    if (!dateISO || !timeHHMM) return null;
    const [y, m, d] = dateISO.split("-").map(Number);
    const [hh, mm] = timeHHMM.split(":").map(Number);
    if ([y, m, d, hh, mm].some((v) => Number.isNaN(v))) return null;
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  }
  function isoStringFromLocalParts(dateISO, timeHHMM) {
    const dt = localDateTimeFromParts(dateISO, timeHHMM);
    if (!dt) return null;
    return dt.toISOString();
  }

  // --- week/month helpers
  function weeksInMonthForDate(date) {
    const first = startOfMonth(date),
      last = endOfMonth(date);
    const dayIdx = (d) => (d.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - dayIdx(first));
    const end = new Date(last);
    end.setDate(last.getDate() + (6 - dayIdx(last)));
    const weeks = [];
    let cur = new Date(start);
    while (cur <= end) {
      const wkStart = new Date(cur);
      const days = [];
      for (let i = 0; i < 7; i++) {
        days.push(
          new Date(
            wkStart.getFullYear(),
            wkStart.getMonth(),
            wkStart.getDate() + i
          )
        );
      }
      weeks.push({
        start: new Date(wkStart),
        end: new Date(
          wkStart.getFullYear(),
          wkStart.getMonth(),
          wkStart.getDate() + 6
        ),
        days,
      });
      cur.setDate(cur.getDate() + 7);
    }
    return weeks;
  }
  function isWeekend(date, cfg) {
    const dow = date.getDay();
    if (dow === 6 && cfg.saturdayOff) return true;
    if (dow === 0 && cfg.sundayOff) return true;
    return false;
  }
  function isPlannedWeekday(date, monthDate, cfg) {
    return date.getMonth() === monthDate.getMonth() && !isWeekend(date, cfg);
  }

  // --- calculations
  function calculateMonthlyMandatoryHours(monthDate, config, logs) {
    const weeks = weeksInMonthForDate(monthDate);
    const mDays = Number(config.mandatoryDaysPerWeek);
    const hrsPerDay = Number(config.mandatoryHoursPerDay);
    let total = 0;
    for (const wk of weeks) {
      const weekdaysInWeek = wk.days.filter((d) =>
        isPlannedWeekday(d, monthDate, config)
      );
      const plannedDays = Math.min(mDays, weekdaysInWeek.length);
      const leavesInWeek = logs.filter((l) => {
        if (l.type !== "Leave") return false;
        const d = parseISO(l.date);
        if (!d) return false;
        return (
          d >= wk.start && d <= wk.end && d.getMonth() === monthDate.getMonth()
        );
      }).length;
      const remainingDays = Math.max(0, plannedDays - leavesInWeek);
      total += remainingDays * hrsPerDay;
    }
    const reduced = (Number(config.allowedWFHPerMonth) || 0) * hrsPerDay;
    return Math.max(0, Number((total - reduced).toFixed(2)));
  }
  function calculatePlannedOfficeDays(monthDate, config) {
    const weeks = weeksInMonthForDate(monthDate);
    const mDays = Number(config.mandatoryDaysPerWeek);
    let totalDays = 0;
    for (const wk of weeks) {
      const weekdaysInWeek = wk.days.filter((d) =>
        isPlannedWeekday(d, monthDate, config)
      );
      totalDays += Math.min(mDays, weekdaysInWeek.length);
    }
    return totalDays;
  }
  function logsForMonth(monthDate, logs) {
    const m = monthDate.getMonth(),
      y = monthDate.getFullYear();
    return logs
      .filter((l) => {
        const d = parseISO(l.date);
        if (!d) return false;
        return d.getFullYear() === y && d.getMonth() === m;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  function sumHours(logs) {
    return logs.reduce(
      (s, l) => (l.type === "Leave" ? s : s + (Number(l.hours) || 0)),
      0
    );
  }
  function countWFHDays(logs) {
    const set = new Set();
    logs.forEach((l) => l.type === "WFH" && set.add(l.date));
    return set.size;
  }
  function countOfficeDays(logs) {
    const set = new Set();
    logs.forEach((l) => l.type === "Office" && set.add(l.date));
    return set.size;
  }
  function countLeaves(logs) {
    const set = new Set();
    logs.forEach((l) => l.type === "Leave" && set.add(l.date));
    return set.size;
  }
  function projectedRequiredHoursUpTo(dateUpTo, config, logs) {
    const monthDate = new Date(dateUpTo.getFullYear(), dateUpTo.getMonth(), 1);
    const weeks = weeksInMonthForDate(monthDate);
    const mDays = config.mandatoryDaysPerWeek,
      hrsPerDay = config.mandatoryHoursPerDay;
    let total = 0;
    for (const wk of weeks) {
      if (wk.start > dateUpTo) break;
      const weekdays = wk.days.filter(
        (d) =>
          d.getMonth() === monthDate.getMonth() &&
          d <= dateUpTo &&
          !isWeekend(d, config)
      );
      const plannedDays = Math.min(mDays, weekdays.length);
      const leavesInWeek = logs.filter((l) => {
        if (l.type !== "Leave") return false;
        const d = parseISO(l.date);
        if (!d) return false;
        return (
          d >= wk.start &&
          d <= wk.end &&
          d.getMonth() === monthDate.getMonth() &&
          d <= dateUpTo
        );
      }).length;
      const remainingDays = Math.max(0, plannedDays - leavesInWeek);
      total += remainingDays * hrsPerDay;
    }
    const daysInMonth = endOfMonth(dateUpTo).getDate();
    const proratedAllowed =
      (Number(config.allowedWFHPerMonth) || 0) *
      (dateUpTo.getDate() / daysInMonth);
    const reduced = proratedAllowed * config.mandatoryHoursPerDay;
    return Number(Math.max(0, total - reduced).toFixed(2));
  }

  // --- DOM refs
  const tabs = document.querySelectorAll(".tab-btn");
  const sections = {
    dashboard: document.getElementById("dashboard"),
    log: document.getElementById("log"),
    config: document.getElementById("config"),
  };

  // config elements
  const elMandatoryDays = document.getElementById("mandatoryDays");
  const elAllowedWFH = document.getElementById("allowedWFH");
  const elHoursPerDay = document.getElementById("hoursPerDay");
  const elWeeklyPreview = document.getElementById("weeklyHoursPreview");
  const configForm = document.getElementById("configForm");
  const btnLoadDefaults = document.getElementById("btnLoadDefaults");
  const elSatOff = document.getElementById("satOff");
  const elSunOff = document.getElementById("sunOff");

  // log form elements
  const logForm = document.getElementById("logForm");
  const elLogDate = document.getElementById("logDate");
  const elInTime = document.getElementById("inTime");
  const elOutTime = document.getElementById("outTime");
  const elCalHours = document.getElementById("calHours");
  const punchInLabel = document.getElementById("punchInLabel");
  const punchOutLabel = document.getElementById("punchOutLabel");
  const typeRadios = document.querySelectorAll('input[name="logType"]');
  const btnToday = document.getElementById("btnToday");

  // dashboard / table refs
  const logsBody = document.getElementById("logsBody");
  const pagerPrev = document.getElementById("pagerPrev");
  const pagerNext = document.getElementById("pagerNext");
  const logsPagerInfo = document.getElementById("logsPagerInfo");

  // other dashboard elements
  const monthPrev = document.getElementById("monthPrev");
  const monthNext = document.getElementById("monthNext");
  const monthPill = document.getElementById("monthPill");
  const monthSelect = document.getElementById("monthSelect");
  const progTitle = document.getElementById("progTitle");
  const goalSummary = document.getElementById("goalSummary");
  const percentLabel = document.getElementById("percentLabel");
  const progressBar = document.getElementById("progressBar");
  const overtimeLabel = document.getElementById("overtimeLabel");
  const viewLabel = document.getElementById("viewLabel");
  const lastUpdated = document.getElementById("lastUpdated");
  const wfhUsed = document.getElementById("wfhUsed");
  const officeRemaining = document.getElementById("officeRemaining");
  const monthlyGoal = document.getElementById("monthlyGoal");
  const splitHours = document.getElementById("splitHours");
  const chartSVG = document.getElementById("chartSVG");

  // state
  let currentPage = 1;
  let monthIndex = 2;
  let baseMonthDate = new Date();
  let editingId = null;

  // --- init
  function init() {
    let cfg = loadConfig();
    if (!cfg) {
      cfg = DEFAULT_CONFIG;
      saveConfig(cfg);
    }
    populateConfigForm(cfg);

    const now = new Date();
    baseMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
    updateMonthPill();

    if (elLogDate) elLogDate.value = formatDateISO(now);
    if (elMandatoryDays)
      elMandatoryDays.addEventListener("input", updateWeeklyPreview);
    if (elHoursPerDay)
      elHoursPerDay.addEventListener("input", updateWeeklyPreview);

    typeRadios.forEach((r) => r.addEventListener("change", onTypeChange));
    onTypeChange();

    tabs.forEach((btn) => btn.addEventListener("click", onTabClick));

    if (elInTime) elInTime.addEventListener("change", onTimeInputChange);
    if (elOutTime) elOutTime.addEventListener("change", onTimeInputChange);
    if (elLogDate) elLogDate.addEventListener("change", onTimeInputChange);

    if (btnToday)
      btnToday.addEventListener("click", () => {
        if (elLogDate) elLogDate.value = formatDateISO(new Date());
      });
    if (logForm) logForm.addEventListener("submit", onLogSubmit);

    if (pagerPrev)
      pagerPrev.addEventListener("click", () => {
        if (currentPage > 1) {
          currentPage--;
          renderLogsTable();
        }
      });
    if (pagerNext)
      pagerNext.addEventListener("click", () => {
        const total = loadLogs().length;
        const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (currentPage < pages) {
          currentPage++;
          renderLogsTable();
        }
      });

    if (btnLoadDefaults)
      btnLoadDefaults.addEventListener("click", () =>
        populateConfigForm(DEFAULT_CONFIG)
      );
    if (configForm) configForm.addEventListener("submit", onConfigSubmit);

    if (monthPrev)
      monthPrev.addEventListener("click", () => changeMonthIndex(-1));
    if (monthNext)
      monthNext.addEventListener("click", () => changeMonthIndex(1));
    if (monthPill)
      monthPill.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") changeMonthIndex(-1);
        if (e.key === "ArrowRight") changeMonthIndex(1);
      });
    addSwipe(monthPill, (dir) => changeMonthIndex(dir === "left" ? 1 : -1));

    updateWeeklyPreview();
    renderDashboard();
    renderLogsTable();
  }

  // --- handlers
  function onConfigSubmit(e) {
    e.preventDefault();
    const mandatoryDays = Number(elMandatoryDays.value);
    const allowedWFH = Number(elAllowedWFH.value);
    const hoursPerDay = Number(elHoursPerDay.value);
    const saturdayOff = !!elSatOff.checked;
    const sundayOff = !!elSunOff.checked;
    if (
      !Number.isFinite(mandatoryDays) ||
      mandatoryDays < 1 ||
      mandatoryDays > 7
    ) {
      alert("Mandatory Office Days per Week must be 1-7.");
      return;
    }
    if (!Number.isFinite(allowedWFH) || allowedWFH < 0 || allowedWFH > 22) {
      alert("Allowed WFH Days per Month must be 0-22.");
      return;
    }
    if (!Number.isFinite(hoursPerDay) || hoursPerDay < 1 || hoursPerDay > 24) {
      alert("Mandatory Hours per Day must be 1-24.");
      return;
    }
    const cfg = {
      mandatoryDaysPerWeek: mandatoryDays,
      allowedWFHPerMonth: allowedWFH,
      mandatoryHoursPerDay: hoursPerDay,
      saturdayOff,
      sundayOff,
      updatedAt: new Date().toISOString(),
    };
    saveConfig(cfg);
    populateConfigForm(cfg);
    renderDashboard();
    alert("Configuration saved ✅");
  }

  function addSwipe(elem, onSwipe) {
    if (!elem) return;
    let startX = 0,
      startT = 0;
    elem.addEventListener(
      "touchstart",
      (e) => {
        const t = e.touches[0];
        startX = t.clientX;
        startT = Date.now();
      },
      { passive: true }
    );
    elem.addEventListener(
      "touchend",
      (e) => {
        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dt = Date.now() - startT;
        if (Math.abs(dx) > 40 && dt < 600) onSwipe(dx < 0 ? "left" : "right");
      },
      { passive: true }
    );
  }

  function onTabClick(e) {
    const btn = e.currentTarget;
    tabs.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    Object.keys(sections).forEach((k) => {
      if (k === tab) {
        sections[k].classList.remove("hidden");
        sections[k].removeAttribute("aria-hidden");
      } else {
        sections[k].classList.add("hidden");
        sections[k].setAttribute("aria-hidden", "true");
      }
    });
    if (tab === "dashboard") {
      renderDashboard();
      renderLogsTable();
    }
  }

  function populateConfigForm(cfg) {
    if (!cfg) cfg = DEFAULT_CONFIG;
    if (elMandatoryDays) elMandatoryDays.value = cfg.mandatoryDaysPerWeek;
    if (elAllowedWFH) elAllowedWFH.value = cfg.allowedWFHPerMonth;
    if (elHoursPerDay) elHoursPerDay.value = cfg.mandatoryHoursPerDay;
    if (elSatOff) elSatOff.checked = !!cfg.saturdayOff;
    if (elSunOff) elSunOff.checked = !!cfg.sundayOff;
    updateWeeklyPreview();
  }
  function updateWeeklyPreview() {
    const d = Number(
      elMandatoryDays
        ? elMandatoryDays.value
        : DEFAULT_CONFIG.mandatoryDaysPerWeek
    );
    const h = Number(
      elHoursPerDay ? elHoursPerDay.value : DEFAULT_CONFIG.mandatoryHoursPerDay
    );
    if (elWeeklyPreview)
      elWeeklyPreview.textContent = `${(d * h).toFixed(2)} hours`;
  }

  function onTypeChange() {
    // no specific UI toggle now; future: hide time inputs when Leave selected
  }

  function onTimeInputChange() {
    if (punchInLabel)
      punchInLabel.textContent =
        elInTime && elInTime.value ? elInTime.value : "—";
    if (punchOutLabel)
      punchOutLabel.textContent =
        elOutTime && elOutTime.value ? elOutTime.value : "—";
    const dateVal = elLogDate ? elLogDate.value : null;
    const inVal = elInTime ? elInTime.value : null;
    const outVal = elOutTime ? elOutTime.value : null;
    if (!dateVal || !inVal || !outVal) {
      if (elCalHours) elCalHours.textContent = "0.00 h";
      return;
    }
    const inDt = localDateTimeFromParts(dateVal, inVal);
    const outDt = localDateTimeFromParts(dateVal, outVal);
    if (!inDt || !outDt || outDt <= inDt) {
      if (elCalHours) elCalHours.textContent = "0.00 h";
      return;
    }
    const hours = (outDt.getTime() - inDt.getTime()) / 3600000;
    if (elCalHours) elCalHours.textContent = `${Number(hours.toFixed(2))} h`;
  }

  function onLogSubmit(e) {
    e.preventDefault();
    const submitBtn = document.querySelector('#logForm button[type="submit"]');
    const date = elLogDate ? elLogDate.value : "";
    if (!date) {
      alert("Please select a date.");
      return;
    }
    const type = getSelectedType();
    let hours = 0;
    if (type === "Leave") {
      hours = 0;
    } else {
      const inVal =
        elInTime && elInTime.value
          ? isoStringFromLocalParts(date, elInTime.value)
          : null;
      const outVal =
        elOutTime && elOutTime.value
          ? isoStringFromLocalParts(date, elOutTime.value)
          : null;
      if (inVal && outVal) {
        const inMs = new Date(inVal).getTime();
        const outMs = new Date(outVal).getTime();
        if (!isNaN(inMs) && !isNaN(outMs) && outMs > inMs)
          hours = Number(((outMs - inMs) / 3600000).toFixed(2));
        else hours = 0;
      } else hours = 0;
    }

    const inIso =
      elInTime && elInTime.value
        ? isoStringFromLocalParts(date, elInTime.value)
        : null;
    const outIso =
      elOutTime && elOutTime.value
        ? isoStringFromLocalParts(date, elOutTime.value)
        : null;
    const logs = loadLogs();

    const entryId = editingId ? editingId : uid();
    const entry = {
      id: entryId,
      date,
      type,
      hours: type === "Leave" ? 0 : hours,
      inTime: inIso,
      outTime: outIso,
      createdAt: new Date().toISOString(),
    };

    if (editingId) {
      const idx = logs.findIndex((l) => l.id === editingId);
      if (idx !== -1) logs[idx] = entry;
      else logs.push(entry);
      saveLogs(logs);
      alert("Entry updated ✅");
    } else {
      const existingIndex = logs.findIndex((l) => l.date === date);
      if (existingIndex !== -1) {
        if (
          !confirm(
            `An entry already exists for ${date} (type: ${logs[existingIndex].type}). Replace it?`
          )
        )
          return;
        entry.id = logs[existingIndex].id;
        logs[existingIndex] = entry;
        saveLogs(logs);
        alert("Entry replaced ✅");
      } else {
        logs.push(entry);
        saveLogs(logs);
        alert("Logged ✅");
      }
    }

    editingId = null;
    if (submitBtn) submitBtn.textContent = "Log Entry";

    if (elInTime) elInTime.value = "";
    if (elOutTime) elOutTime.value = "";
    if (elCalHours) elCalHours.textContent = "0.00 h";
    if (punchInLabel) punchInLabel.textContent = "—";
    if (punchOutLabel) punchOutLabel.textContent = "—";

    renderDashboard();
    renderLogsTable();
  }

  function getSelectedType() {
    const c = document.querySelector('input[name="logType"]:checked');
    return c ? c.value : "Office";
  }

  function changeMonthIndex(delta) {
    const minIndex = 0,
      maxIndex = 2;
    const newIndex = Math.max(minIndex, Math.min(maxIndex, monthIndex + delta));
    if (newIndex === monthIndex) return;
    monthIndex = newIndex;
    updateMonthPill();
    renderDashboard();
    renderLogsTable();
  }
  function updateMonthPill() {
    const shift = 2 - monthIndex;
    const d = new Date(
      baseMonthDate.getFullYear(),
      baseMonthDate.getMonth() - shift,
      1
    );
    if (monthPill)
      monthPill.textContent = d.toLocaleString(undefined, {
        month: "long",
        year: "numeric",
      });
    if (monthPrev) monthPrev.disabled = monthIndex <= 0;
    if (monthNext) monthNext.disabled = monthIndex >= 2;
    if (monthSelect)
      monthSelect.value = `${d.getFullYear()}-${String(
        d.getMonth() + 1
      ).padStart(2, "0")}`;
  }

  // --- Unified logs table renderer
  function renderLogsTable() {
    const all = loadLogs().sort((a, b) => b.date.localeCompare(a.date));
    const total = all.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > pages) currentPage = pages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = all.slice(start, start + PAGE_SIZE);

    if (logsBody) logsBody.innerHTML = "";

    slice.forEach((l) => {
      const tr = document.createElement("tr");

      const tdDate = document.createElement("td");
      tdDate.textContent = l.date;
      const tdIn = document.createElement("td");
      tdIn.textContent = formatTimeShort(l.inTime);
      const tdOut = document.createElement("td");
      tdOut.textContent = formatTimeShort(l.outTime);
      const tdHours = document.createElement("td");
      tdHours.textContent =
        l.type === "Leave" ? "-" : Number(l.hours || 0).toFixed(2) + " h";

      const tdType = document.createElement("td");
      const pill = document.createElement("span");
      // build pill class safely (no inline multi-line string)
      const pillClass =
        l.type === "Office"
          ? "pill-office"
          : l.type === "Leave"
          ? "pill-leave"
          : "pill-wfh";
      pill.className = "type-pill " + pillClass;
      pill.textContent = l.type;
      tdType.appendChild(pill);

      const tdAction = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "table-actions";

      const btnEdit = document.createElement("button");
      btnEdit.className = "btn small";
      btnEdit.textContent = "Edit";
      btnEdit.addEventListener("click", () => loadEntryIntoForm(l));

      const btnDelete = document.createElement("button");
      btnDelete.className = "btn ghost small";
      btnDelete.textContent = "Delete";
      btnDelete.addEventListener("click", () => {
        if (!confirm("Delete this entry?")) return;
        const newLogs = loadLogs().filter((x) => x.id !== l.id);
        saveLogs(newLogs);
        renderLogsTable();
        renderDashboard();
      });

      actions.appendChild(btnEdit);
      actions.appendChild(btnDelete);
      tdAction.appendChild(actions);

      tr.appendChild(tdDate);
      tr.appendChild(tdIn);
      tr.appendChild(tdOut);
      tr.appendChild(tdHours);
      tr.appendChild(tdType);
      tr.appendChild(tdAction);

      if (logsBody) logsBody.appendChild(tr);
    });

    if (logsPagerInfo)
      logsPagerInfo.textContent = `Page ${currentPage} / ${pages} · ${total} records`;
    if (pagerPrev) pagerPrev.disabled = currentPage <= 1;
    if (pagerNext) pagerNext.disabled = currentPage >= pages;
  }

  function loadEntryIntoForm(entry) {
    // switch to Log tab
    tabs.forEach((b) => b.classList.remove("active"));
    const logTabBtn = document.querySelector('.tab-btn[data-tab="log"]');
    if (logTabBtn) logTabBtn.classList.add("active");
    Object.keys(sections).forEach((k) => {
      if (k === "log") {
        sections[k].classList.remove("hidden");
        sections[k].removeAttribute("aria-hidden");
      } else {
        sections[k].classList.add("hidden");
        sections[k].setAttribute("aria-hidden", "true");
      }
    });

    // populate
    if (elLogDate) elLogDate.value = entry.date;
    const r = document.querySelector(
      `input[name="logType"][value="${entry.type}"]`
    );
    if (r) r.checked = true;
    onTypeChange();

    editingId = entry.id;
    const submitBtn = document.querySelector('#logForm button[type="submit"]');
    if (submitBtn) submitBtn.textContent = "Update Entry";

    if (entry.inTime) {
      const dt = new Date(entry.inTime);
      if (!isNaN(dt) && elInTime)
        elInTime.value = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      if (punchInLabel)
        punchInLabel.textContent =
          elInTime && elInTime.value ? elInTime.value : "—";
    } else {
      if (elInTime) elInTime.value = "";
      if (punchInLabel) punchInLabel.textContent = "—";
    }

    if (entry.outTime) {
      const dt2 = new Date(entry.outTime);
      if (!isNaN(dt2) && elOutTime)
        elOutTime.value = `${pad(dt2.getHours())}:${pad(dt2.getMinutes())}`;
      if (punchOutLabel)
        punchOutLabel.textContent =
          elOutTime && elOutTime.value ? elOutTime.value : "—";
    } else {
      if (elOutTime) elOutTime.value = "";
      if (punchOutLabel) punchOutLabel.textContent = "—";
    }

    if (elCalHours)
      elCalHours.textContent =
        entry.type === "Leave"
          ? "0.00 h"
          : `${Number((entry.hours || 0).toFixed(2))} h`;
  }

  // --- Dashboard renderer
  function renderDashboard() {
    const cfg = loadConfig() || DEFAULT_CONFIG;
    const allLogs = loadLogs();
    const shift = 2 - monthIndex;
    const selectedMonthDate = new Date(
      baseMonthDate.getFullYear(),
      baseMonthDate.getMonth() - shift,
      1
    );

    const monthLogs = logsForMonth(selectedMonthDate, allLogs);
    const monthlyHoursActual = sumHours(monthLogs);
    const monthlyLeaves = countLeaves(monthLogs);
    const monthlyOfficeCount = countOfficeDays(monthLogs);

    const monthlyMandatory = calculateMonthlyMandatoryHours(
      selectedMonthDate,
      cfg,
      allLogs
    );
    const plannedOfficeDays = calculatePlannedOfficeDays(
      selectedMonthDate,
      cfg
    );

    if (wfhUsed)
      wfhUsed.textContent = `Implicit hybrid days: not required to log • Extra allowed WFH this month: ${cfg.allowedWFHPerMonth}`;
    const officeRemainingCount = Math.max(
      0,
      plannedOfficeDays - monthlyLeaves - monthlyOfficeCount
    );
    if (officeRemaining)
      officeRemaining.textContent = `${officeRemainingCount} day(s) remaining`;

    if (monthlyGoal) monthlyGoal.textContent = `${monthlyMandatory} hours`;
    const officeHours = monthLogs
      .filter((l) => l.type === "Office")
      .reduce((s, l) => s + (l.hours || 0), 0);
    if (splitHours)
      splitHours.textContent = `Office ${officeHours.toFixed(
        2
      )}h • Logged total ${monthlyHoursActual.toFixed(2)}h`;

    const percent =
      monthlyMandatory > 0
        ? Math.min(
            100,
            Math.round((monthlyHoursActual / monthlyMandatory) * 100)
          )
        : 0;
    if (percentLabel) percentLabel.textContent = `${percent}%`;
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (goalSummary)
      goalSummary.textContent = `${monthlyMandatory} hours required • ${monthlyHoursActual.toFixed(
        2
      )} logged`;
    if (lastUpdated) lastUpdated.textContent = new Date().toLocaleString();
    if (viewLabel)
      viewLabel.textContent = `Viewing ${selectedMonthDate.toLocaleString(
        undefined,
        { month: "long", year: "numeric" }
      )}`;

    const today = new Date();
    const upToDate =
      selectedMonthDate.getFullYear() === today.getFullYear() &&
      selectedMonthDate.getMonth() === today.getMonth()
        ? today
        : endOfMonth(selectedMonthDate);
    const requiredUpTo = projectedRequiredHoursUpTo(upToDate, cfg, allLogs);
    const actualUpTo = monthLogs
      .filter((l) => {
        const d = parseISO(l.date);
        return d && d <= upToDate;
      })
      .reduce((s, l) => s + (l.type === "Leave" ? 0 : l.hours || 0), 0);
    const ot = Number((actualUpTo - requiredUpTo).toFixed(2));
    if (overtimeLabel)
      overtimeLabel.textContent =
        ot >= 0 ? `Overtime: +${ot}h` : `Undertime: ${ot}h`;

    renderChart(selectedMonthDate, allLogs);
  }

  // --- Smoothed chart renderer (replace previous renderChart)
  function renderChart(selectedMonthDate, allLogs) {
    // last 30 days ending at end of selected month (or today if current month)
    const now = new Date();
    const isCurrentMonthView =
      selectedMonthDate.getFullYear() === now.getFullYear() &&
      selectedMonthDate.getMonth() === now.getMonth();
    const endDate = isCurrentMonthView ? now : endOfMonth(selectedMonthDate);
    const days = [];
    for (let i = 29; i >= 0; i--)
      days.push(
        new Date(
          endDate.getFullYear(),
          endDate.getMonth(),
          endDate.getDate() - i
        )
      );

    // build plannedMap (per-day planned hours) using your existing logic
    const cfg = loadConfig() || DEFAULT_CONFIG;
    const plannedMap = {};
    const weeks = weeksInMonthForDate(selectedMonthDate);
    for (const wk of weeks) {
      const weekdays = wk.days
        .filter((d) => isPlannedWeekday(d, selectedMonthDate, cfg))
        .sort((a, b) => a - b);
      const take = Math.min(cfg.mandatoryDaysPerWeek, weekdays.length);
      for (let i = 0; i < weekdays.length; i++) {
        plannedMap[formatDateISO(weekdays[i])] =
          i < take ? cfg.mandatoryHoursPerDay : 0;
      }
    }

    // aggregate actual hours per day
    const actualMap = {};
    const all = loadLogs();
    all.forEach((l) => {
      actualMap[l.date] =
        (actualMap[l.date] || 0) +
        (l.type === "Leave" ? 0 : Number(l.hours || 0));
    });

    const plannedArr = days.map((d) => plannedMap[formatDateISO(d)] || 0);
    const actualArr = days.map((d) => actualMap[formatDateISO(d)] || 0);

    // SVG sizing
    const svg = chartSVG;
    if (!svg) return;
    const W = Math.max(520, svg.clientWidth || 600);
    const H = 220;
    const padL = 46,
      padR = 12,
      padT = 16,
      padB = 34;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // clear
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // scales
    const maxVal = Math.max(8, ...plannedArr, ...actualArr);
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const xFor = (i) => padL + (i / (days.length - 1)) * innerW;
    const yFor = (v) => padT + (1 - v / maxVal) * innerH;

    // grid lines (subtle)
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const y = padT + (innerH * i) / gridCount;
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line"
      );
      line.setAttribute("x1", padL);
      line.setAttribute("x2", W - padR);
      line.setAttribute("y1", y);
      line.setAttribute("y2", y);
      line.setAttribute("stroke", "rgba(255,255,255,0.06)");
      line.setAttribute("stroke-width", "1");
      svg.appendChild(line);
      // left axis labels
      const val = Math.round((1 - i / gridCount) * maxVal);
      const lbl = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );
      lbl.setAttribute("x", padL - 10);
      lbl.setAttribute("y", y + 4);
      lbl.setAttribute("text-anchor", "end");
      lbl.setAttribute("fill", "rgba(255,255,255,0.65)");
      lbl.setAttribute("font-size", "11");
      lbl.textContent = val;
      svg.appendChild(lbl);
    }

    // X axis tick labels (sparse)
    for (let i = 0; i < days.length; i += 6) {
      const tx = document.createElementNS("http://www.w3.org/2000/svg", "text");
      tx.setAttribute("x", xFor(i));
      tx.setAttribute("y", H - 8);
      tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("fill", "rgba(255,255,255,0.6)");
      tx.setAttribute("font-size", "11");
      tx.textContent = formatDateISO(days[i]).slice(5);
      svg.appendChild(tx);
    }

    // build points arrays
    const ptsPlanned = plannedArr.map((v, i) => ({
      x: xFor(i),
      y: yFor(v),
      v,
      i,
    }));
    const ptsActual = actualArr.map((v, i) => ({
      x: xFor(i),
      y: yFor(v),
      v,
      i,
    }));

    // helper: create smoothed path from points using Catmull-Rom -> bezier conversion
    function pointsToSmoothPath(points) {
      if (!points.length) return "";
      if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
      // build coordinates array for catmull function: [x,y,x,y,...]
      const coord = [];
      points.forEach((p) => {
        coord.push(p.x);
        coord.push(p.y);
      });
      const beziers = catmullRom2bezier(coord, false, 0.2); // tighter smoothing with alpha ~= 0.2
      // beziers is array of segments with [x1,y1,x2,y2,x,y] sequences as string
      // start move to first point
      let d = `M ${points[0].x} ${points[0].y} `;
      beziers.forEach((seg) => {
        // seg is array of numbers [x1,y1,x2,y2,x3,y3]
        d += `C ${seg[0]} ${seg[1]}, ${seg[2]} ${seg[3]}, ${seg[4]} ${seg[5]} `;
      });
      return d;
    }

    // planned: dashed, thinner
    const plannedPathD = pointsToSmoothPath(ptsPlanned);
    if (plannedPathD) {
      const pPath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      pPath.setAttribute("d", plannedPathD);
      pPath.setAttribute("fill", "none");
      pPath.setAttribute("stroke", "var(--accent-2, #e34d56)"); // planned color (use CSS var)
      pPath.setAttribute("stroke-width", "2");
      pPath.setAttribute("stroke-dasharray", "6 6");
      pPath.setAttribute("stroke-linecap", "round");
      svg.appendChild(pPath);
    }

    // actual: solid, thicker, subtle glow
    const actualPathD = pointsToSmoothPath(ptsActual);
    if (actualPathD) {
      // subtle drop shadow (duplicate thicker translucent path)
      const shadow = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      shadow.setAttribute("d", actualPathD);
      shadow.setAttribute("fill", "none");
      shadow.setAttribute("stroke", "rgba(0,0,0,0.25)");
      shadow.setAttribute("stroke-width", "6");
      shadow.setAttribute("stroke-linecap", "round");
      shadow.setAttribute("opacity", "0.18");
      svg.appendChild(shadow);

      const aPath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      aPath.setAttribute("d", actualPathD);
      aPath.setAttribute("fill", "none");
      aPath.setAttribute("stroke", "var(--accent, #e31b23)"); // actual color (use CSS var)
      aPath.setAttribute("stroke-width", "2.8");
      aPath.setAttribute("stroke-linecap", "round");
      aPath.setAttribute("stroke-linejoin", "round");
      svg.appendChild(aPath);
    }

    // markers: small circles on actual points (only when value > 0)
    ptsActual.forEach((p) => {
      if (!p.v || p.v <= 0) return;
      const c = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      c.setAttribute("cx", p.x);
      c.setAttribute("cy", p.y);
      c.setAttribute("r", 2.6);
      c.setAttribute("fill", "var(--accent, #e31b23)");
      c.setAttribute("stroke", "rgba(0,0,0,0.18)");
      c.setAttribute("stroke-width", "0.8");
      svg.appendChild(c);
    });

    // small legend top-left
    const legendX = padL + 6,
      legendY = padT + 6;
    const l1 = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    l1.setAttribute("x", legendX);
    l1.setAttribute("y", legendY - 8);
    l1.setAttribute("width", 10);
    l1.setAttribute("height", 6);
    l1.setAttribute("fill", "var(--accent, #e31b23)");
    svg.appendChild(l1);
    const l1t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    l1t.setAttribute("x", legendX + 16);
    l1t.setAttribute("y", legendY - 2);
    l1t.setAttribute("fill", "rgba(255,255,255,0.9)");
    l1t.setAttribute("font-size", "11");
    l1t.textContent = "Actual";
    svg.appendChild(l1t);

    const l2 = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    l2.setAttribute("x", legendX + 86);
    l2.setAttribute("y", legendY - 8);
    l2.setAttribute("width", 10);
    l2.setAttribute("height", 6);
    l2.setAttribute("fill", "var(--accent-2, #60a5fa)");
    svg.appendChild(l2);
    const l2t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    l2t.setAttribute("x", legendX + 102);
    l2t.setAttribute("y", legendY - 2);
    l2t.setAttribute("fill", "rgba(255,255,255,0.9)");
    l2t.setAttribute("font-size", "11");
    l2t.textContent = "Planned";
    svg.appendChild(l2t);

    // note: small border around chart (like your reference)
    const border = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect"
    );
    border.setAttribute("x", padL - 6);
    border.setAttribute("y", padT - 8);
    border.setAttribute("width", innerW + 12);
    border.setAttribute("height", innerH + 16);
    border.setAttribute("fill", "none");
    border.setAttribute("stroke", "rgba(255,255,255,0.03)");
    border.setAttribute("stroke-width", "1");
    svg.appendChild(border);
  }

  // --- Catmull-Rom to cubic Bézier converter
  // input: flat array coords = [x0,y0,x1,y1,x2,y2,...]
  // closed: boolean, tension/alpha value (0..1) where lower -> tighter
  function catmullRom2bezier(coords, closed = false, tension = 0.5) {
    // returns array of segments, each segment is [x1,y1,x2,y2,x3,y3] suitable for "C" command
    const points = [];
    for (let i = 0; i < coords.length; i += 2)
      points.push([coords[i], coords[i + 1]]);
    const result = [];
    const l = points.length;

    if (l < 2) return result;
    for (let i = 0; i < l - (closed ? 0 : 1); i++) {
      const p0 = points[(i - 1 + l) % l];
      const p1 = points[i % l];
      const p2 = points[(i + 1) % l];
      const p3 = points[(i + 2) % l];

      // algorithm from Catmull-Rom to Bezier conversion
      const t = tension;
      const bp1x = p1[0] + ((p2[0] - p0[0]) * t) / 6;
      const bp1y = p1[1] + ((p2[1] - p0[1]) * t) / 6;
      const bp2x = p2[0] - ((p3[0] - p1[0]) * t) / 6;
      const bp2y = p2[1] - ((p3[1] - p1[1]) * t) / 6;

      // target end point is p2
      result.push([bp1x, bp1y, bp2x, bp2y, p2[0], p2[1]]);
    }
    return result;
  }

  // --- export / clear
  function onExport() {
    const logs = loadLogs(),
      cfg = loadConfig();
    const payload = { config: cfg, logs, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `worktracker_export_${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function onClear() {
    if (
      !confirm(
        "Clear all stored configuration and logs? This cannot be undone."
      )
    )
      return;
    localStorage.removeItem(KEY_CONFIG);
    localStorage.removeItem(KEY_LOGS);
    alert("Cleared. Reloading with defaults.");
    location.reload();
  }

  // boot
  init();

  // expose
  window._workTracker = { loadConfig, loadLogs, saveConfig, saveLogs };
})();
