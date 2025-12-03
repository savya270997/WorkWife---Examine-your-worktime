/*
  Work Tracker — Updated Leave logging behavior
  - Leave entries are loggable (hours input remains enabled)
  - For calculations, Leave always counts as a full-day leave (hours = 0 in storage)
  - All other behaviors retained: implicit WFH, allowedWFH reductions, line chart, pagination
*/

(() => {
  const KEY_CONFIG = "workTrackerConfig";
  const KEY_LOGS = "workTrackerDailyLogs";
  const PAGE_SIZE = 10;

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

  // Utilities
  function formatDateISO(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
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
    const first = startOfMonth(date);
    const last = endOfMonth(date);
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
      for (let i = 0; i < 7; i++) {
        days.push(
          new Date(
            weekStart.getFullYear(),
            weekStart.getMonth(),
            weekStart.getDate() + i
          )
        );
      }
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
    const dow = date.getDay(); // 0=Sun,6=Sat
    if (dow === 6 && cfg.saturdayOff) return true;
    if (dow === 0 && cfg.sundayOff) return true;
    return false;
  }
  function isPlannedWeekday(date, monthDate, cfg) {
    return date.getMonth() === monthDate.getMonth() && !isWeekend(date, cfg);
  }

  // CORE: monthly mandatory hours calculation
  function calculateMonthlyMandatoryHours(monthDate, config, logs) {
    const weeks = weeksInMonthForDate(monthDate);
    const mDays = config.mandatoryDaysPerWeek;
    const hrsPerDay = config.mandatoryHoursPerDay;
    let total = 0;
    for (const wk of weeks) {
      const weekdaysInWeek = wk.days.filter((d) =>
        isPlannedWeekday(d, monthDate, config)
      );
      const plannedDays = Math.min(mDays, weekdaysInWeek.length);
      // leaves count: each logged Leave in that week (and in the month) reduces planned days by 1
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
    // subtract allowed extra WFH days (reduces required hours)
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
    const m = monthDate.getMonth();
    const y = monthDate.getFullYear();
    return logs
      .filter((l) => {
        const d = parseISO(l.date);
        if (!d) return false;
        return d.getFullYear() === y && d.getMonth() === m;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function sumHours(logs) {
    return logs.reduce((s, l) => {
      if (l.type === "Leave") return s;
      return s + (Number(l.hours) || 0);
    }, 0);
  }

  function countWFHDays(logs) {
    const set = new Set();
    logs.forEach((l) => {
      if (l.type === "WFH") set.add(l.date);
    });
    return set.size;
  }
  function countOfficeDays(logs) {
    const set = new Set();
    logs.forEach((l) => {
      if (l.type === "Office") set.add(l.date);
    });
    return set.size;
  }
  function countLeaves(logs) {
    const set = new Set();
    logs.forEach((l) => {
      if (l.type === "Leave") set.add(l.date);
    });
    return set.size;
  }

  function projectedRequiredHoursUpTo(dateUpTo, config, logs) {
    const monthDate = new Date(dateUpTo.getFullYear(), dateUpTo.getMonth(), 1);
    const weeks = weeksInMonthForDate(monthDate);
    const mDays = config.mandatoryDaysPerWeek;
    const hrsPerDay = config.mandatoryHoursPerDay;
    let total = 0;
    for (const wk of weeks) {
      const wkStart = wk.start;
      if (wkStart > dateUpTo) break;
      const weekdays = wk.days.filter((d) => {
        const inMonth = d.getMonth() === monthDate.getMonth();
        const avant = d <= dateUpTo;
        return inMonth && avant && !isWeekend(d, config);
      });
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
    const reduced = proratedAllowed * hrsPerDay;
    return Number(Math.max(0, total - reduced).toFixed(2));
  }

  // UI wiring
  const tabs = document.querySelectorAll(".tab-btn");
  const sections = {
    dashboard: document.getElementById("dashboard"),
    log: document.getElementById("log"),
    config: document.getElementById("config"),
  };

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
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
    });
  });

  // DOM elements
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

  const recentBody = document.getElementById("recentBody");
  const viewAllBtn = document.getElementById("viewAllBtn");
  const allLogsArea = document.getElementById("allLogsArea");
  const allLogsBody = document.getElementById("allLogsBody");
  const btnExport = document.getElementById("btnExport");
  const btnClear = document.getElementById("btnClear");

  const pagerPrev = document.getElementById("pagerPrev");
  const pagerNext = document.getElementById("pagerNext");
  const logsPagerInfo = document.getElementById("logsPagerInfo");

  let currentPage = 1;

  // init
  function init() {
    let cfg = loadConfig();
    if (!cfg) {
      cfg = DEFAULT_CONFIG;
      saveConfig(cfg);
    }
    populateConfigForm(cfg);

    const now = new Date();
    monthSelect.value = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}`;
    elLogDate.value = formatDateISO(now);
    elHoursWorked.value =
      cfg.mandatoryHoursPerDay || DEFAULT_CONFIG.mandatoryHoursPerDay;

    elMandatoryDays.addEventListener("input", updateWeeklyPreview);
    elHoursPerDay.addEventListener("input", updateWeeklyPreview);

    // direct listeners on radios
    typeRadios.forEach((r) => r.addEventListener("change", onTypeChange));

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

    updateWeeklyPreview();
    renderDashboard();
    renderRecentLogs();
    // ensure type behavior matches default checked
    onTypeChange();
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

  configForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const mandatoryDaysPerWeek = Number(elMandatoryDays.value);
    const allowedWFHPerMonth = Number(elAllowedWFH.value);
    const mandatoryHoursPerDay = Number(elHoursPerDay.value);
    const saturdayOff = !!elSatOff.checked;
    const sundayOff = !!elSunOff.checked;
    if (
      !Number.isInteger(mandatoryDaysPerWeek) ||
      mandatoryDaysPerWeek < 1 ||
      mandatoryDaysPerWeek > 7
    ) {
      alert(
        "Mandatory Office Days per Week must be an integer between 1 and 7."
      );
      return;
    }
    if (
      !Number.isFinite(allowedWFHPerMonth) ||
      allowedWFHPerMonth < 0 ||
      allowedWFHPerMonth > 22
    ) {
      alert("Allowed extra WFH Days per Month must be between 0 and 22.");
      return;
    }
    if (
      !Number.isFinite(mandatoryHoursPerDay) ||
      mandatoryHoursPerDay <= 0 ||
      mandatoryHoursPerDay > 24
    ) {
      alert("Mandatory Hours per Day must be between 1 and 24.");
      return;
    }
    const cfg = {
      mandatoryDaysPerWeek,
      allowedWFHPerMonth,
      mandatoryHoursPerDay,
      saturdayOff,
      sundayOff,
    };
    saveConfig(cfg);
    alert("Configuration saved ✅");
    renderDashboard();
  });

  btnLoadDefaults &&
    btnLoadDefaults.addEventListener("click", () => {
      populateConfigForm(DEFAULT_CONFIG);
    });

  btnToday &&
    btnToday.addEventListener("click", () => {
      elLogDate.value = formatDateISO(new Date());
    });

  function onTypeChange() {
    // Keep hours visible + enabled in all cases (user can type if they want).
    // But Leave entries will be stored with hours=0 and used as full-day leaves in calculations.
    // Provide helpful placeholder to indicate behavior.
    const selected = getSelectedType();
    if (selected === "Leave") {
      elHoursWorked.placeholder = "Hours ignored for Leave (full-day leave)";
      elHoursWorked.value = ""; // clear to avoid accidental carryover
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

  logForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const date = elLogDate.value;
    if (!date) {
      alert("Please select a date.");
      return;
    }
    const type = getSelectedType();
    let hours = 0;
    if (type === "Leave") {
      // Store hours as 0 for leave entries (used by calculations as full-day leave)
      hours = 0;
    } else {
      const hv = elHoursWorked.value;
      hours = hv === "" || hv === null ? 0 : Number(hv);
      if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
        alert("Please enter valid hours (0-24).");
        return;
      }
    }
    const logs = loadLogs();
    const entry = {
      id: id(),
      date,
      type,
      // Persist hours as 0 for Leave (ensures leaves are identifiable and consistent)
      hours: type === "Leave" ? 0 : Number(Number(hours).toFixed(2)),
      createdAt: new Date().toISOString(),
    };
    logs.push(entry);
    saveLogs(logs);
    alert("Logged ✅");
    elHoursWorked.value = "";
    onTypeChange(); // refresh placeholder/default
    renderDashboard();
    renderRecentLogs();
  });

  function renderDashboard() {
    const cfg = loadConfig() || DEFAULT_CONFIG;
    const allLogs = loadLogs();
    const [selYear, selMon] = (monthSelect.value || "").split("-").map(Number);
    let selectedMonthDate;
    if (selYear && selMon) {
      selectedMonthDate = new Date(selYear, selMon - 1, 1);
    } else {
      const now = new Date();
      selectedMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
      monthSelect.value = `${selectedMonthDate.getFullYear()}-${String(
        selectedMonthDate.getMonth() + 1
      ).padStart(2, "0")}`;
    }

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

  monthSelect.addEventListener("change", () => renderDashboard());

  // Chart: line graph for last 30 days
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
    allLogs.forEach((l) => {
      actualMap[l.date] =
        (actualMap[l.date] || 0) +
        (l.type === "Leave" ? 0 : Number(l.hours || 0));
    });

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

  btnExport.addEventListener("click", () => {
    const logs = loadLogs();
    const cfg = loadConfig();
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
  });

  btnClear.addEventListener("click", () => {
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
  });

  // boot
  init();

  // expose minimal API
  window._workTracker = { loadConfig, loadLogs, saveConfig, saveLogs };
})();
