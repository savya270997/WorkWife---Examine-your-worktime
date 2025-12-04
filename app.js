/*
  Work Tracker — Unique log per date + 3-month carousel (current + prev1 + prev2)
  - Single-file localStorage keys: workTrackerConfig, workTrackerDailyLogs
  - If adding a log for a date that already exists: confirm replace (replace keeps uniqueness)
  - Month carousel: index 0 = current-2, 1 = current-1, 2 = current
  - Swipe support on month pill for touch devices
  - Rest features retained: implicit WFH, allowed WFH reduction, line chart, pagination
*/

(() => {
  const KEY_CONFIG = "workTrackerConfig";
  const KEY_LOGS = "workTrackerDailyLogs";
  const PAGE_SIZE = 10;

  // storage helpers
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

  const DEFAULT_CONFIG = {
    mandatoryDaysPerWeek: 3,
    allowedWFHPerMonth: 0,
    mandatoryHoursPerDay: 9,
    saturdayOff: true,
    sundayOff: true,
    updatedAt: new Date().toISOString(),
  };

  // utils
  function formatDateISO(d) {
    const yyyy = d.getFullYear(),
      mm = String(d.getMonth() + 1).padStart(2, "0"),
      dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  function parseISO(s) {
    const [y, m, d] = (s || "").split("-").map(Number);
    if (!y) return null;
    return new Date(y, m - 1, d);
  }
  function id() {
    return Math.random().toString(36).slice(2, 9);
  }
  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  function weeksInMonthForDate(date) {
    const first = startOfMonth(date),
      last = endOfMonth(date);
    const dayOfWeek = (d) => (d.getDay() + 6) % 7; // 0=Mon
    const start = new Date(first);
    start.setDate(first.getDate() - dayOfWeek(first));
    const end = new Date(last);
    end.setDate(last.getDate() + (6 - dayOfWeek(last)));
    const weeks = [];
    let cur = new Date(start);
    while (cur <= end) {
      const weekStart = new Date(cur);
      const days = [];
      for (let i = 0; i < 7; i++)
        days.push(
          new Date(
            weekStart.getFullYear(),
            weekStart.getMonth(),
            weekStart.getDate() + i
          )
        );
      weeks.push({
        start: new Date(weekStart),
        end: new Date(
          weekStart.getFullYear(),
          weekStart.getMonth(),
          weekStart.getDate() + 6
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

  // core calculations
  function calculateMonthlyMandatoryHours(monthDate, config, logs) {
    const weeks = weeksInMonthForDate(monthDate);
    const mDays = config.mandatoryDaysPerWeek,
      hrsPerDay = config.mandatoryHoursPerDay;
    let total = 0;
    for (const wk of weeks) {
      const weekdaysInWeek = wk.days.filter((d) =>
        isPlannedWeekday(d, monthDate, config)
      );
      const plannedDays = Math.min(mDays, weekdaysInWeek.length);
      const leavesInWeek = logs.filter(
        (l) =>
          l.type === "Leave" &&
          (() => {
            const d = parseISO(l.date);
            return (
              d &&
              d >= wk.start &&
              d <= wk.end &&
              d.getMonth() === monthDate.getMonth()
            );
          })()
      ).length;
      const remainingDays = Math.max(0, plannedDays - leavesInWeek);
      total += remainingDays * hrsPerDay;
    }
    const reduced = (Number(config.allowedWFHPerMonth) || 0) * hrsPerDay;
    return Math.max(0, Number((total - reduced).toFixed(2)));
  }

  function calculatePlannedOfficeDays(monthDate, config) {
    const weeks = weeksInMonthForDate(monthDate);
    const mDays = config.mandatoryDaysPerWeek;
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
      const leavesInWeek = logs.filter(
        (l) =>
          l.type === "Leave" &&
          (() => {
            const d = parseISO(l.date);
            return (
              d &&
              d >= wk.start &&
              d <= wk.end &&
              d.getMonth() === monthDate.getMonth() &&
              d <= dateUpTo
            );
          })()
      ).length;
      const remainingDays = Math.max(0, plannedDays - leavesInWeek);
      total += remainingDays * hrsPerDay;
    }
    const daysInMonth = endOfMonth(dateUpTo).getDate();
    const proratedAllowed =
      (Number(config.allowedWFHPerMonth) || 0) *
      (dateUpTo.getDate() / daysInMonth);
    const reduced = proratedAllowed * hrsPerDay;
    return Number(Math.max(0, total - reduced).toFixed(2));
  }

  // UI elements
  const tabs = document.querySelectorAll(".tab-btn");
  const sections = {
    dashboard: document.getElementById("dashboard"),
    log: document.getElementById("log"),
    config: document.getElementById("config"),
  };

  const elMandatoryDays = document.getElementById("mandatoryDays");
  const elAllowedWFH = document.getElementById("allowedWFH");
  const elHoursPerDay = document.getElementById("hoursPerDay");
  const elWeeklyPreview = document.getElementById("weeklyHoursPreview");
  const configForm = document.getElementById("configForm");
  const btnLoadDefaults = document.getElementById("btnLoadDefaults");
  const elSatOff = document.getElementById("satOff");
  const elSunOff = document.getElementById("sunOff");

  const logForm = document.getElementById("logForm");
  const elLogDate = document.getElementById("logDate");
  const elHoursWorked = document.getElementById("hoursWorked");
  const typeRadios = document.querySelectorAll('input[name="logType"]');
  const btnToday = document.getElementById("btnToday");

  // month carousel elements
  const monthPrev = document.getElementById("monthPrev");
  const monthNext = document.getElementById("monthNext");
  const monthPill = document.getElementById("monthPill");
  const monthSelect = document.getElementById("monthSelect"); // hidden fallback

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

  const recentBody = document.getElementById("recentBody");
  const viewAllBtn = document.getElementById("viewAllBtn");
  const allLogsArea = document.getElementById("allLogsArea");
  const allLogsBody = document.getElementById("allLogsBody");
  const btnExport = document.getElementById("btnExport");
  const btnClear = document.getElementById("btnClear");

  const pagerPrev = document.getElementById("pagerPrev");
  const pagerNext = document.getElementById("pagerNext");
  const logsPagerInfo = document.getElementById("logsPagerInfo");

  // paging state
  let currentPage = 1;

  // month state: index 0 = current-2, 1 = current-1, 2 = current
  let monthIndex = 2; // default current month
  let baseMonthDate = new Date(); // current date used as base

  // init
  function init() {
    let cfg = loadConfig();
    if (!cfg) {
      cfg = DEFAULT_CONFIG;
      saveConfig(cfg);
    }
    populateConfigForm(cfg);

    const now = new Date();
    baseMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
    monthIndex = 2;
    updateMonthPill();

    elLogDate.value = formatDateISO(now);
    elHoursWorked.value =
      cfg.mandatoryHoursPerDay || DEFAULT_CONFIG.mandatoryHoursPerDay;

    elMandatoryDays.addEventListener("input", updateWeeklyPreview);
    elHoursPerDay.addEventListener("input", updateWeeklyPreview);

    typeRadios.forEach((r) => r.addEventListener("change", onTypeChange));
    onTypeChange();

    tabs.forEach((btn) => btn.addEventListener("click", onTabClick));
    monthPrev.addEventListener("click", () => changeMonthIndex(-1));
    monthNext.addEventListener("click", () => changeMonthIndex(1));
    monthPill.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") changeMonthIndex(-1);
      if (e.key === "ArrowRight") changeMonthIndex(1);
    });

    // touch swipe for monthPill
    addSwipe(monthPill, (dir) => changeMonthIndex(dir === "left" ? 1 : -1));

    pagerPrev.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        populateAllLogsTable();
      }
    });
    pagerNext.addEventListener("click", () => {
      const total = loadLogs().length;
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (currentPage < pages) {
        currentPage++;
        populateAllLogsTable();
      }
    });

    logForm.addEventListener("submit", onLogSubmit);

    btnLoadDefaults &&
      btnLoadDefaults.addEventListener("click", () =>
        populateConfigForm(DEFAULT_CONFIG)
      );
    btnToday &&
      btnToday.addEventListener(
        "click",
        () => (elLogDate.value = formatDateISO(new Date()))
      );
    btnExport.addEventListener("click", onExport);
    btnClear.addEventListener("click", onClear);

    updateWeeklyPreview();
    renderDashboard();
    renderRecentLogs();
  }

  function addSwipe(elem, onSwipe) {
    // simple left/right swipe detection
    let startX = 0,
      startTime = 0;
    elem.addEventListener(
      "touchstart",
      (e) => {
        const t = e.touches[0];
        startX = t.clientX;
        startTime = Date.now();
      },
      { passive: true }
    );
    elem.addEventListener(
      "touchend",
      (e) => {
        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dt = Date.now() - startTime;
        if (Math.abs(dx) > 40 && dt < 600) {
          onSwipe(dx < 0 ? "left" : "right");
        }
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
    if (tab === "dashboard") renderDashboard();
  }

  function populateConfigForm(cfg) {
    elMandatoryDays.value = cfg.mandatoryDaysPerWeek;
    elAllowedWFH.value = cfg.allowedWFHPerMonth;
    elHoursPerDay.value = cfg.mandatoryHoursPerDay;
    elSatOff.checked = !!cfg.saturdayOff;
    elSunOff.checked = !!cfg.sundayOff;
    updateWeeklyPreview();
  }

  function updateWeeklyPreview() {
    const d = Number(
      elMandatoryDays.value || DEFAULT_CONFIG.mandatoryDaysPerWeek
    );
    const h = Number(
      elHoursPerDay.value || DEFAULT_CONFIG.mandatoryHoursPerDay
    );
    elWeeklyPreview.textContent = `${(d * h).toFixed(2)} hours`;
  }

  function onTypeChange() {
    const selected = getSelectedType();
    if (selected === "Leave") {
      elHoursWorked.placeholder = "Hours ignored for Leave (full-day leave)";
      elHoursWorked.value = "";
    } else {
      const cfg = loadConfig() || DEFAULT_CONFIG;
      elHoursWorked.placeholder = "";
      if (!elHoursWorked.value)
        elHoursWorked.value =
          cfg.mandatoryHoursPerDay || DEFAULT_CONFIG.mandatoryHoursPerDay;
    }
  }

  function getSelectedType() {
    const checked = document.querySelector('input[name="logType"]:checked');
    return checked ? checked.value : "Office";
  }

  function onLogSubmit(e) {
    e.preventDefault();
    const date = elLogDate.value;
    if (!date) {
      alert("Please select a date.");
      return;
    }
    const type = getSelectedType();
    let hours = 0;
    if (type === "Leave") {
      hours = 0;
    } else {
      const hv = elHoursWorked.value;
      hours = hv === "" || hv == null ? 0 : Number(hv);
      if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
        alert("Please enter valid hours (0-24).");
        return;
      }
    }

    // uniqueness: check if entry exists for this date
    const logs = loadLogs();
    const existingIndex = logs.findIndex((l) => l.date === date);
    if (existingIndex !== -1) {
      // prompt replace
      if (
        !confirm(
          `An entry already exists for ${date} (type: ${logs[existingIndex].type}). Replace it?`
        )
      ) {
        return; // abort
      }
      // replace existing
      const entry = {
        id: logs[existingIndex].id,
        date,
        type,
        hours: type === "Leave" ? 0 : Number(Number(hours).toFixed(2)),
        createdAt: new Date().toISOString(),
      };
      logs[existingIndex] = entry;
      saveLogs(logs);
      alert("Entry replaced ✅");
      elHoursWorked.value = "";
      onTypeChange();
      renderDashboard();
      renderRecentLogs();
      return;
    }

    // add new entry
    const entry = {
      id: id(),
      date,
      type,
      hours: type === "Leave" ? 0 : Number(Number(hours).toFixed(2)),
      createdAt: new Date().toISOString(),
    };
    logs.push(entry);
    saveLogs(logs);
    alert("Logged ✅");
    elHoursWorked.value = "";
    onTypeChange();
    renderDashboard();
    renderRecentLogs();
  }

  function changeMonthIndex(delta) {
    const minIndex = 0,
      maxIndex = 2;
    const newIndex = Math.max(minIndex, Math.min(maxIndex, monthIndex + delta));
    if (newIndex === monthIndex) return;
    monthIndex = newIndex;
    updateMonthPill();
    renderDashboard();
  }

  function updateMonthPill() {
    // compute month date for current baseMonthDate minus (2 - monthIndex) months
    const shift = 2 - monthIndex; // monthIndex=2 => shift=0 (current); 1 => shift=1 (prev1); 0 => shift=2 (prev2)
    const d = new Date(
      baseMonthDate.getFullYear(),
      baseMonthDate.getMonth() - shift,
      1
    );
    monthPill.textContent = d.toLocaleString(undefined, {
      month: "long",
      year: "numeric",
    });
    // enable/disable arrows
    monthPrev.disabled = monthIndex <= 0;
    monthNext.disabled = monthIndex >= 2;
    // update hidden monthSelect fallback
    monthSelect.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
  }

  function renderDashboard() {
    const cfg = loadConfig() || DEFAULT_CONFIG;
    const allLogs = loadLogs();

    // compute selected month date from monthIndex
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

    wfhUsed.textContent = `Implicit hybrid days: not required to log • Extra allowed WFH this month: ${cfg.allowedWFHPerMonth}`;
    const officeRemainingCount = Math.max(
      0,
      plannedOfficeDays - monthlyLeaves - monthlyOfficeCount
    );
    officeRemaining.textContent = `${officeRemainingCount} day(s) remaining`;

    monthlyGoal.textContent = `${monthlyMandatory} hours`;
    const officeHours = monthLogs
      .filter((l) => l.type === "Office")
      .reduce((s, l) => s + (l.hours || 0), 0);
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
    percentLabel.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
    goalSummary.textContent = `${monthlyMandatory} hours required • ${monthlyHoursActual.toFixed(
      2
    )} logged`;
    lastUpdated.textContent = new Date().toLocaleString();
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
    overtimeLabel.textContent =
      ot >= 0 ? `Overtime: +${ot}h` : `Undertime: ${ot}h`;

    renderRecentLogs();
    renderChart(selectedMonthDate, allLogs);

    allLogsArea.classList.add("hidden");
    allLogsArea.setAttribute("aria-hidden", "true");
    viewAllBtn.textContent = "View All Logs";
  }

  function renderRecentLogs() {
    const allLogs = loadLogs()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);
    recentBody.innerHTML = "";
    allLogs.forEach((l) => {
      const tr = document.createElement("tr");
      const tdDate = document.createElement("td");
      tdDate.textContent = l.date;
      const tdType = document.createElement("td");
      const chip = document.createElement("span");
      chip.className =
        "type-chip " +
        (l.type === "Office"
          ? "chip-office"
          : l.type === "WFH"
          ? "chip-wfh"
          : "chip-leave");
      chip.textContent = l.type;
      tdType.appendChild(chip);
      const tdHours = document.createElement("td");
      tdHours.textContent =
        l.type === "Leave" ? "-" : Number(l.hours || 0).toFixed(2) + " h";
      tr.appendChild(tdDate);
      tr.appendChild(tdType);
      tr.appendChild(tdHours);
      recentBody.appendChild(tr);
    });
    currentPage = 1;
    populateAllLogsTable();
  }

  function populateAllLogsTable() {
    const allLogs = loadLogs().sort((a, b) => b.date.localeCompare(a.date));
    const total = allLogs.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > pages) currentPage = pages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = allLogs.slice(start, start + PAGE_SIZE);

    allLogsBody.innerHTML = "";
    slice.forEach((l) => {
      const tr = document.createElement("tr");
      const tdDate = document.createElement("td");
      tdDate.textContent = l.date;
      const tdType = document.createElement("td");
      const chip = document.createElement("span");
      chip.className =
        "type-chip " +
        (l.type === "Office"
          ? "chip-office"
          : l.type === "WFH"
          ? "chip-wfh"
          : "chip-leave");
      chip.textContent = l.type;
      tdType.appendChild(chip);
      const tdHours = document.createElement("td");
      tdHours.textContent =
        l.type === "Leave" ? "-" : Number(l.hours || 0).toFixed(2) + " h";
      const tdAction = document.createElement("td");
      const btnDelete = document.createElement("button");
      btnDelete.className = "btn ghost small";
      btnDelete.textContent = "Delete";
      btnDelete.addEventListener("click", () => {
        if (!confirm("Delete this entry?")) return;
        const logs = loadLogs().filter((x) => x.id !== l.id);
        saveLogs(logs);
        renderDashboard();
        renderRecentLogs();
      });
      tdAction.appendChild(btnDelete);
      tr.appendChild(tdDate);
      tr.appendChild(tdType);
      tr.appendChild(tdHours);
      tr.appendChild(tdAction);
      allLogsBody.appendChild(tr);
    });

    logsPagerInfo.textContent = `Page ${currentPage} / ${pages} · ${total} records`;
    pagerPrev.disabled = currentPage <= 1;
    pagerNext.disabled = currentPage >= pages;
  }

  viewAllBtn.addEventListener("click", () => {
    if (allLogsArea.classList.contains("hidden")) {
      currentPage = 1;
      populateAllLogsTable();
      allLogsArea.classList.remove("hidden");
      allLogsArea.removeAttribute("aria-hidden");
      viewAllBtn.textContent = "Hide All Logs";
    } else {
      allLogsArea.classList.add("hidden");
      allLogsArea.setAttribute("aria-hidden", "true");
      viewAllBtn.textContent = "View All Logs";
    }
  });

  monthSelect.addEventListener("change", () => {
    // fallback: set monthIndex based on selected month relative to baseMonthDate (clamped to last 2 months)
    const [y, m] = (monthSelect.value || "").split("-").map(Number);
    if (!y || !m) return;
    const sel = new Date(y, m - 1, 1);
    const diffMonths =
      (baseMonthDate.getFullYear() - sel.getFullYear()) * 12 +
      (baseMonthDate.getMonth() - sel.getMonth());
    // diffMonths: 0 = same month, 1 = previous month, 2 = two months ago, etc.
    const idx = 2 - Math.max(0, Math.min(2, diffMonths));
    monthIndex = idx;
    updateMonthPill();
    renderDashboard();
  });

  // Chart: line graph for last 30 days (same as previous)
  function renderChart(selectedMonthDate, allLogs) {
    const now = new Date();
    const isCurrentMonthView =
      selectedMonthDate.getFullYear() === now.getFullYear() &&
      selectedMonthDate.getMonth() === now.getMonth();
    const endDate = isCurrentMonthView ? now : endOfMonth(selectedMonthDate);
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate() - i
      );
      days.push(d);
    }

    const cfg = loadConfig() || DEFAULT_CONFIG;
    const plannedMap = {};
    const weeks = weeksInMonthForDate(selectedMonthDate);
    for (const wk of weeks) {
      const weekdays = wk.days
        .filter((d) => isPlannedWeekday(d, selectedMonthDate, cfg))
        .sort((a, b) => a - b);
      const take = Math.min(cfg.mandatoryDaysPerWeek, weekdays.length);
      for (let i = 0; i < weekdays.length; i++) {
        const ds = formatDateISO(weekdays[i]);
        plannedMap[ds] = i < take ? cfg.mandatoryHoursPerDay : 0;
      }
    }
    const actualMap = {};
    allLogs.forEach(
      (l) =>
        (actualMap[l.date] =
          (actualMap[l.date] || 0) +
          (l.type === "Leave" ? 0 : Number(l.hours || 0)))
    );

    const plannedArr = days.map((d) => plannedMap[formatDateISO(d)] || 0);
    const actualArr = days.map((d) => actualMap[formatDateISO(d)] || 0);

    const svg = chartSVG;
    const W = 600,
      H = 180;
    const padL = 36,
      padR = 8,
      padT = 12,
      padB = 28;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const maxVal = Math.max(...plannedArr, ...actualArr, 8);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const y = padT + ((H - padT - padB) * i) / gridCount;
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
      const val = (maxVal * (1 - i / gridCount)).toFixed(0);
      const text = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );
      text.setAttribute("x", 6);
      text.setAttribute("y", y + 4);
      text.setAttribute("fill", "rgba(255,255,255,0.6)");
      text.setAttribute("font-size", "10");
      text.textContent = val;
      svg.appendChild(text);
    }

    const innerW = W - padL - padR;
    function xFor(i) {
      return padL + (i / (days.length - 1)) * innerW;
    }
    function yFor(v) {
      return padT + (1 - v / maxVal) * (H - padT - padB);
    }

    const plannedPoints = plannedArr
      .map((v, i) => `${xFor(i)},${yFor(v)}`)
      .join(" ");
    const plannedPoly = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline"
    );
    plannedPoly.setAttribute("points", plannedPoints);
    plannedPoly.setAttribute("fill", "none");
    plannedPoly.setAttribute("stroke", "rgba(229,9,20,0.7)");
    plannedPoly.setAttribute("stroke-width", "2");
    plannedPoly.setAttribute("stroke-dasharray", "6 4");
    svg.appendChild(plannedPoly);

    const actualPoints = actualArr
      .map((v, i) => `${xFor(i)},${yFor(v)}`)
      .join(" ");
    const actualPoly = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline"
    );
    actualPoly.setAttribute("points", actualPoints);
    actualPoly.setAttribute("fill", "none");
    actualPoly.setAttribute("stroke", "rgba(62,92,255,0.95)");
    actualPoly.setAttribute("stroke-width", "2.5");
    actualPoly.setAttribute("stroke-linejoin", "round");
    actualPoly.setAttribute("stroke-linecap", "round");
    svg.appendChild(actualPoly);

    for (let i = 0; i < actualArr.length; i++) {
      if (actualArr[i] > 0) {
        const cx = xFor(i),
          cy = yFor(actualArr[i]);
        const c = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle"
        );
        c.setAttribute("cx", cx);
        c.setAttribute("cy", cy);
        c.setAttribute("r", 2.4);
        c.setAttribute("fill", "rgba(62,92,255,0.95)");
        svg.appendChild(c);
      }
    }

    for (let i = 0; i < days.length; i++) {
      if (i % 6 === 0) {
        const tx = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text"
        );
        tx.setAttribute("x", xFor(i));
        tx.setAttribute("y", H - 6);
        tx.setAttribute("fill", "rgba(255,255,255,0.6)");
        tx.setAttribute("font-size", "10");
        tx.setAttribute("text-anchor", "middle");
        tx.textContent = formatDateISO(days[i]).slice(5);
        svg.appendChild(tx);
      }
    }

    const legendPl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect"
    );
    legendPl.setAttribute("x", W - 170);
    legendPl.setAttribute("y", 8);
    legendPl.setAttribute("width", 10);
    legendPl.setAttribute("height", 8);
    legendPl.setAttribute("fill", "rgba(229,9,20,0.7)");
    svg.appendChild(legendPl);
    const legendPlText = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );
    legendPlText.setAttribute("x", W - 154);
    legendPlText.setAttribute("y", 15);
    legendPlText.setAttribute("fill", "rgba(255,255,255,0.9)");
    legendPlText.setAttribute("font-size", "10");
    legendPlText.textContent = "Planned";
    svg.appendChild(legendPlText);

    const legendAc = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect"
    );
    legendAc.setAttribute("x", W - 92);
    legendAc.setAttribute("y", 8);
    legendAc.setAttribute("width", 10);
    legendAc.setAttribute("height", 8);
    legendAc.setAttribute("fill", "rgba(62,92,255,0.95)");
    svg.appendChild(legendAc);
    const legendAcText = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );
    legendAcText.setAttribute("x", W - 76);
    legendAcText.setAttribute("y", 15);
    legendAcText.setAttribute("fill", "rgba(255,255,255,0.9)");
    legendAcText.setAttribute("font-size", "10");
    legendAcText.textContent = "Actual";
    svg.appendChild(legendAcText);
  }

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

  // expose minimal API for debugging
  window._workTracker = { loadConfig, loadLogs, saveConfig, saveLogs };
})();
