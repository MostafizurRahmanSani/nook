const COLORS = { blue: '#3b6f8c', coral: '#e77f68', sage: '#6fa383', amber: '#e2b04a' };

const today = new Date();
let visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedDate = new Date(today);
let selectedColor = 'blue';
let editingId = null;
let panelOpen = false;
let popover = null;
let showCompleted = false;
let tasks = [];

const $ = (selector) => document.querySelector(selector);
const monthLabel = $('#month-label');
const yearLabel = $('#year-label');
const monthSummary = $('#month-summary');
const calendarGrid = $('#calendar-grid');
const dayEyebrow = $('#day-eyebrow');
const dayTitle = $('#day-title');
const progressBar = $('#progress-bar');
const progressText = $('#progress-text');
const taskList = $('#task-list');
const agendaList = $('#agenda-list');
const taskForm = $('#task-form');
const taskInput = $('#task-input');
const taskTime = $('#task-time');
const taskRepeat = $('#task-repeat');
const swatches = $('#swatches');
const reminderDayBefore = $('#reminder-day-before');
const reminderDayOf = $('#reminder-day-of');
const reminderDayOfTime = $('#reminder-day-of-time');

const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'long' });
const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const weekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
const agendaDateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

function saveTasks() {
  window.widget.saveTasks(tasks);
}

const pad = (value) => String(value).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDateKey = (key) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const isSameDay = (first, second) => dateKey(first) === dateKey(second);

function occursOn(task, key) {
  if (task.repeat === 'daily') return key >= task.date;
  if (task.repeat === 'weekly') return key >= task.date && parseDateKey(key).getDay() === parseDateKey(task.date).getDay();
  return task.date === key;
}

function isDoneOn(task, key) {
  if (task.repeat && task.repeat !== 'none') return (task.doneDates || []).includes(key);
  return task.done;
}

function toggleDoneOn(task, key) {
  if (task.repeat && task.repeat !== 'none') {
    const set = new Set(task.doneDates || []);
    if (set.has(key)) set.delete(key); else set.add(key);
    task.doneDates = [...set];
  } else {
    task.done = !task.done;
  }
}

function findTask(id) {
  return tasks.find((entry) => entry.id === id);
}

function tasksFor(key) {
  return tasks
    .filter((task) => occursOn(task, key))
    .map((task) => ({ ...task, date: key, done: isDoneOn(task, key) }))
    .sort((a, b) => a.done - b.done || (a.time || '99:99').localeCompare(b.time || '99:99') || a.created - b.created);
}

function relativeLabel(date) {
  const diff = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (diff === 0) return 'TODAY';
  if (diff === 1) return 'TOMORROW';
  if (diff === -1) return 'YESTERDAY';
  return weekdayFormatter.format(date).toUpperCase();
}

function agendaDateLabel(date) {
  const diff = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (diff === 1) return 'TOMORROW';
  return agendaDateFormatter.format(date).toUpperCase();
}

function formatTime(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${pad(minutes)} ${hours < 12 ? 'AM' : 'PM'}`;
}

/* ---------- calendar ---------- */

function renderCalendar() {
  monthLabel.textContent = monthFormatter.format(visibleMonth);
  yearLabel.textContent = visibleMonth.getFullYear();
  calendarGrid.replaceChildren();

  ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((label) => {
    const weekday = document.createElement('span');
    weekday.className = 'weekday';
    weekday.textContent = label;
    calendarGrid.append(weekday);
  });

  const startDate = new Date(visibleMonth);
  startDate.setDate(1 - visibleMonth.getDay());
  let monthOpen = 0;
  let monthDone = 0;

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    const dayTasks = tasksFor(dateKey(date));
    if (date.getMonth() === visibleMonth.getMonth()) {
      dayTasks.forEach((task) => { if (task.done) monthDone += 1; else monthOpen += 1; });
    }

    const day = document.createElement('button');
    day.className = 'day';
    day.setAttribute('aria-label', dayFormatter.format(date));
    day.dataset.key = dateKey(date);
    day.append(String(date.getDate()));

    if (date.getMonth() !== visibleMonth.getMonth()) day.classList.add('outside');
    if (date.getDay() === 0 || date.getDay() === 6) day.classList.add('weekend');
    if (isSameDay(date, today)) day.classList.add('today');
    if (isSameDay(date, selectedDate)) day.classList.add('selected');

    const dots = document.createElement('span');
    dots.className = 'dots';
    dayTasks.slice(0, 3).forEach((task) => {
      const dot = document.createElement('i');
      if (task.done) dot.className = 'done';
      dots.append(dot);
    });
    day.append(dots);

    day.addEventListener('click', () => {
      const alreadyOpenForThis = popover && isSameDay(selectedDate, date);
      selectedDate = date;
      editingId = null;
      if (date.getMonth() !== visibleMonth.getMonth()) visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      render();
      if (alreadyOpenForThis) hidePopover();
      else if (!panelOpen) showPopover();
    });
    calendarGrid.append(day);
  }

  const monthTotal = monthOpen + monthDone;
  monthSummary.textContent = monthTotal ? `${monthOpen} open · ${monthDone} done this month` : 'No tasks this month';
}

/* ---------- tasks ---------- */

function renderTasks() {
  const key = dateKey(selectedDate);
  const dayTasks = tasksFor(key);
  const done = dayTasks.filter((task) => task.done).length;

  dayEyebrow.textContent = relativeLabel(selectedDate);
  dayTitle.textContent = dayFormatter.format(selectedDate);
  progressBar.parentElement.hidden = !dayTasks.length;
  progressText.hidden = !dayTasks.length;
  if (dayTasks.length) {
    progressBar.style.width = `${(done / dayTasks.length) * 100}%`;
    progressText.textContent = done === dayTasks.length ? `All ${done} done — nice work` : `${done} of ${dayTasks.length} done`;
  }

  taskList.replaceChildren();

  if (!dayTasks.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.innerHTML = '<b>A clear day</b>Add a task below to plan it.';
    taskList.append(empty);
    return;
  }

  dayTasks.forEach((task) => taskList.append(taskItem(task)));

  if (done) {
    const clear = document.createElement('button');
    clear.className = 'clear';
    clear.textContent = `Clear ${done} completed`;
    clear.addEventListener('click', () => {
      tasks = tasks.filter((task) => !(task.date === key && task.done && (!task.repeat || task.repeat === 'none')));
      saveTasks();
      render();
    });
    const item = document.createElement('li');
    item.append(clear);
    taskList.append(item);
  }
}

function taskItem(task) {
  const item = document.createElement('li');
  item.className = `task${task.done ? ' done' : ''}`;
  item.style.setProperty('--tag', COLORS[task.color] || COLORS.blue);

  const check = document.createElement('button');
  check.className = 'check';
  check.setAttribute('role', 'checkbox');
  check.setAttribute('aria-checked', String(task.done));
  check.setAttribute('aria-label', `Mark "${task.title}" ${task.done ? 'not done' : 'done'}`);
  check.addEventListener('click', () => {
    toggleDoneOn(findTask(task.id), task.date);
    saveTasks();
    render();
  });

  const body = document.createElement('div');
  body.className = 'body';

  if (editingId === task.id) {
    const input = document.createElement('input');
    input.className = 'edit';
    input.value = task.title;
    input.maxLength = 120;
    const finish = (commit) => {
      if (editingId !== task.id) return;
      editingId = null;
      const value = input.value.trim();
      if (commit && value) findTask(task.id).title = value;
      saveTasks();
      render();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    body.append(input);
    queueMicrotask(() => { input.focus(); input.select(); });
  } else {
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = task.title;
    title.title = task.title;
    title.addEventListener('dblclick', () => {
      editingId = task.id;
      renderTasks();
    });
    body.append(title);
    if (task.time || (task.repeat && task.repeat !== 'none') || task.reminder?.enabled) {
      const time = document.createElement('span');
      time.className = 'time';
      const bits = [];
      if (task.time) bits.push(formatTime(task.time));
      if (task.repeat && task.repeat !== 'none') bits.push(task.repeat === 'daily' ? '↻ Daily' : '↻ Weekly');
      if (task.reminder?.enabled) bits.push('🔔');
      time.textContent = bits.join(' · ');
      body.append(time);
    }
  }

  const remove = document.createElement('button');
  remove.className = 'remove';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Delete "${task.title}"`);
  remove.addEventListener('click', () => {
    tasks = tasks.filter((entry) => entry.id !== task.id);
    saveTasks();
    render();
  });

  item.append(check, body, remove);
  return item;
}

function render() {
  renderCalendar();
  renderTasks();
  renderAgenda();
}

/* ---------- agenda ---------- */

function agendaTaskItem(task) {
  const item = document.createElement('li');
  item.className = `agenda-task${task.done ? ' done' : ''}`;
  item.style.setProperty('--tag', COLORS[task.color] || COLORS.blue);

  const check = document.createElement('button');
  check.className = 'agenda-check';
  check.setAttribute('role', 'checkbox');
  check.setAttribute('aria-checked', String(task.done));
  check.setAttribute('aria-label', `Mark "${task.title}" ${task.done ? 'not done' : 'done'}`);
  check.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleDoneOn(findTask(task.id), task.date);
    saveTasks();
    render();
  });

  const body = document.createElement('div');
  body.className = 'agenda-body';
  const title = document.createElement('span');
  title.className = 'agenda-task-title';
  title.textContent = task.title + (task.repeat && task.repeat !== 'none' ? ' ↻' : '');
  title.title = task.title;
  body.append(title);
  if (task.time) {
    const time = document.createElement('span');
    time.className = 'agenda-task-time';
    time.textContent = formatTime(task.time);
    body.append(time);
  }

  const remove = document.createElement('button');
  remove.className = 'agenda-remove';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Delete "${task.title}"`);
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    tasks = tasks.filter((entry) => entry.id !== task.id);
    saveTasks();
    render();
  });

  item.append(check, body, remove);
  item.addEventListener('click', () => {
    selectedDate = parseDateKey(task.date);
    editingId = null;
    visibleMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    openPanel();
  });

  return item;
}

function agendaGroup(label, dayTasks) {
  const group = document.createElement('div');
  group.className = 'agenda-group';
  const heading = document.createElement('p');
  heading.className = 'agenda-date';
  heading.textContent = label;
  group.append(heading);

  if (dayTasks.length) {
    const list = document.createElement('ul');
    list.className = 'agenda-tasks';
    dayTasks.forEach((task) => list.append(agendaTaskItem(task)));
    group.append(list);
  } else {
    const empty = document.createElement('p');
    empty.className = 'agenda-empty';
    empty.textContent = 'No tasks';
    group.append(empty);
  }

  return group;
}

function completedTaskItem(task) {
  const item = document.createElement('li');
  item.className = 'agenda-task done completed-task';
  item.style.setProperty('--tag', COLORS[task.color] || COLORS.blue);

  const body = document.createElement('div');
  body.className = 'agenda-body';
  const title = document.createElement('span');
  title.className = 'agenda-task-title';
  title.textContent = task.title;
  title.title = task.title;
  const meta = document.createElement('span');
  meta.className = 'agenda-task-time';
  meta.textContent = agendaDateFormatter.format(parseDateKey(task.date)).toUpperCase();
  body.append(title, meta);

  const recurring = task.repeat && task.repeat !== 'none';

  const undo = document.createElement('button');
  undo.className = 'agenda-undo';
  undo.type = 'button';
  undo.textContent = 'Undo';
  undo.setAttribute('aria-label', `Mark "${task.title}" not done`);
  undo.addEventListener('click', () => {
    toggleDoneOn(findTask(task.id), task.date);
    saveTasks();
    render();
  });

  item.append(body, undo);

  if (!recurring) {
    const remove = document.createElement('button');
    remove.className = 'agenda-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete "${task.title}"`);
    remove.addEventListener('click', () => {
      tasks = tasks.filter((entry) => entry.id !== task.id);
      saveTasks();
      render();
    });
    item.append(remove);
  }

  return item;
}

function allCompletedOccurrences() {
  const results = [];
  tasks.forEach((task) => {
    if (!task.repeat || task.repeat === 'none') {
      if (task.done) results.push(task);
      return;
    }
    (task.doneDates || []).forEach((d) => results.push({ ...task, date: d, done: true }));
  });
  return results.sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
}

function renderAgenda() {
  agendaList.replaceChildren();

  const todayKey = dateKey(today);
  const todayTasks = tasksFor(todayKey).filter((task) => !task.done);
  const futureKeys = [];
  for (let i = 1; i <= 60 && futureKeys.length < 6; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const key = dateKey(d);
    if (tasks.some((task) => occursOn(task, key) && !isDoneOn(task, key))) futureKeys.push(key);
  }

  agendaList.append(agendaGroup(`TODAY · ${agendaDateFormatter.format(today).toUpperCase()}`, todayTasks));
  futureKeys.forEach((key) => {
    agendaList.append(agendaGroup(agendaDateLabel(parseDateKey(key)), tasksFor(key).filter((task) => !task.done)));
  });

  const completedTasks = allCompletedOccurrences();

  if (completedTasks.length) {
    const toggle = document.createElement('button');
    toggle.className = 'agenda-completed-toggle';
    toggle.type = 'button';
    toggle.textContent = `${showCompleted ? '▾' : '▸'} Completed (${completedTasks.length})`;
    toggle.addEventListener('click', () => {
      showCompleted = !showCompleted;
      render();
    });
    agendaList.append(toggle);

    if (showCompleted) {
      const list = document.createElement('ul');
      list.className = 'agenda-tasks';
      completedTasks.forEach((task) => list.append(completedTaskItem(task)));
      agendaList.append(list);
    }
  }
}

/* ---------- composer ---------- */

Object.entries(COLORS).forEach(([name, value]) => {
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = 'swatch';
  swatch.style.setProperty('--c', value);
  swatch.setAttribute('role', 'radio');
  swatch.setAttribute('aria-label', name);
  swatch.dataset.color = name;
  swatch.addEventListener('click', () => selectColor(name));
  swatches.append(swatch);
});

function selectColor(name) {
  selectedColor = name;
  swatches.querySelectorAll('.swatch').forEach((swatch) => {
    swatch.setAttribute('aria-checked', String(swatch.dataset.color === name));
  });
  $('#task-form').style.setProperty('--picked', COLORS[name] || COLORS.blue);
}
selectColor(selectedColor);

function updateDayOfTimeLabel() {
  reminderDayOfTime.textContent = taskTime.value ? formatTime(taskTime.value) : '9am';
}
taskTime.addEventListener('input', updateDayOfTimeLabel);

taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = taskInput.value.trim();
  if (!title) return;
  const repeat = taskRepeat.value;
  const dayBefore = reminderDayBefore.checked;
  const dayOf = reminderDayOf.checked;
  tasks.push({
    id: crypto.randomUUID(),
    date: dateKey(selectedDate),
    title,
    time: taskTime.value,
    color: selectedColor,
    repeat,
    doneDates: repeat !== 'none' ? [] : undefined,
    done: false,
    reminder: { enabled: dayBefore || dayOf, dayBefore, dayOf },
    notifiedDayBefore: [],
    notifiedDayOf: [],
    created: Date.now()
  });
  saveTasks();
  taskInput.value = '';
  taskTime.value = '';
  taskRepeat.value = 'none';
  reminderDayBefore.checked = false;
  reminderDayOf.checked = false;
  updateDayOfTimeLabel();
  render();
  taskInput.focus();
});

/* ---------- chrome ---------- */

let popoverBackdrop = null;
const hideOnBlur = () => hidePopover();

function hidePopover() {
  popover?.remove();
  popover = null;
  popoverBackdrop?.remove();
  popoverBackdrop = null;
  window.removeEventListener('blur', hideOnBlur);
}

function showPopover() {
  hidePopover();
  const anchor = calendarGrid.querySelector(`[data-key="${dateKey(selectedDate)}"]`);
  if (!anchor) return;
  const dayTasks = tasksFor(dateKey(selectedDate));
  const done = dayTasks.filter((task) => task.done).length;

  popover = document.createElement('div');
  popover.className = 'popover';
  popover.setAttribute('role', 'dialog');

  const info = document.createElement('div');
  info.className = 'info';
  const heading = document.createElement('b');
  heading.textContent = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(selectedDate);
  const detail = document.createElement('span');
  detail.textContent = dayTasks.length ? `${dayTasks.length} ${dayTasks.length === 1 ? 'task' : 'tasks'} · ${done} done` : 'No tasks yet';
  info.append(heading, detail);

  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = '+ Add task';
  add.addEventListener('click', () => openPanel(true));

  popover.append(info, add);
  document.body.append(popover);

  const rect = anchor.getBoundingClientRect();
  const box = popover.getBoundingClientRect();
  const center = rect.left + rect.width / 2;
  const left = Math.max(8, Math.min(center - box.width / 2, window.innerWidth - box.width - 8));
  const above = rect.top - box.height - 10 >= 8;
  popover.classList.toggle('below', !above);
  popover.style.left = `${left}px`;
  popover.style.top = `${above ? rect.top - box.height - 8 : rect.bottom + 8}px`;
  popover.style.setProperty('--arrow', `${center - left}px`);
}

function openPanel(focusInput = false) {
  hidePopover();
  panelOpen = true;
  $('#shell').classList.add('open');
  render();
  if (focusInput) setTimeout(() => taskInput.focus(), 120);
}

function closePanel() {
  panelOpen = false;
  editingId = null;
  $('#shell').classList.remove('open');
  render();
}

$('#collapse-button').addEventListener('click', closePanel);
document.addEventListener('mousedown', (event) => {
  if (popover && !popover.contains(event.target) && !event.target.closest('.day, #sync-button')) hidePopover();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || document.activeElement?.classList.contains('edit')) return;
  if (popover) hidePopover();
  else if (panelOpen) closePanel();
});

function showMonth(date) {
  hidePopover();
  visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  render();
}

$('#previous-button').addEventListener('click', () => showMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1)));
$('#next-button').addEventListener('click', () => showMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1)));
$('#today-button').addEventListener('click', () => {
  selectedDate = new Date(today);
  editingId = null;
  showMonth(today);
});
$('#close-button').addEventListener('click', () => window.widget.close());
$('#calendar-toggle').addEventListener('click', (event) => {
  const showing = event.currentTarget.getAttribute('aria-pressed') === 'true';
  const next = !showing;
  event.currentTarget.setAttribute('aria-pressed', String(next));
  event.currentTarget.title = next ? 'Hide calendar' : 'Show calendar';
  $('#shell').classList.toggle('calendar-hidden', !next);
  try { localStorage.setItem('little-calendar-show-calendar', String(next)); } catch {}
});

const calendarVisible = (() => {
  try { return localStorage.getItem('little-calendar-show-calendar') === 'true'; } catch { return false; }
})();
if (!calendarVisible) {
  $('#shell').classList.add('calendar-hidden');
  $('#calendar-toggle').setAttribute('aria-pressed', 'false');
  $('#calendar-toggle').title = 'Show calendar';
}
$('#pin-toggle').addEventListener('click', (event) => {
  const active = event.currentTarget.getAttribute('aria-checked') !== 'true';
  event.currentTarget.setAttribute('aria-checked', String(active));
  window.widget.setAlwaysOnTop(active);
});

/* ---------- sync ---------- */

let syncState = { dropbox: false, folder: null };

function setSyncStatus(state) {
  syncState = state;
  const button = $('#sync-button');
  const active = [state.dropbox && 'Dropbox', state.folder && 'a folder'].filter(Boolean);
  button.classList.toggle('synced', active.length > 0);
  button.title = active.length ? `Synced with ${active.join(' and ')} — click to manage` : 'Not synced — click to choose how to sync';
}

const refreshSyncStatus = async () => setSyncStatus(await window.widget.getSyncStatus());
refreshSyncStatus();

// One row per sync option: shows its state and either a Connect or a Disconnect button.
function syncRow(name, detail, connected, onConnect, onDisconnect) {
  const row = document.createElement('div');
  row.className = 'row';

  const info = document.createElement('div');
  info.className = 'info';
  const heading = document.createElement('b');
  heading.textContent = name;
  const sub = document.createElement('span');
  sub.textContent = detail;
  info.append(heading, sub);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = connected ? 'quiet' : '';
  button.textContent = connected ? 'Disconnect' : 'Connect';
  button.addEventListener('click', () => {
    hidePopover();
    (connected ? onDisconnect : onConnect)();
  });

  row.append(info, button);
  return row;
}

function showSyncPopover() {
  hidePopover();
  popover = document.createElement('div');
  popover.className = 'popover below sync';
  popover.setAttribute('role', 'dialog');

  const folderName = syncState.folder ? syncState.folder.split(/[\\/]/).filter(Boolean).pop() : '';
  popover.append(
    syncRow('Dropbox', syncState.dropbox ? 'Connected · synced' : 'Sign in with your account', syncState.dropbox,
      async () => setSyncStatus({ ...syncState, dropbox: await window.widget.connectDropbox() }),
      async () => { await window.widget.disconnectDropbox(); await refreshSyncStatus(); }),
    syncRow('Cloud folder', syncState.folder ? folderName : 'Google Drive, OneDrive…', Boolean(syncState.folder),
      async () => {
        const result = await window.widget.chooseSyncFolder(tasks);
        if (!result) return;
        tasks = result.tasks;
        editingId = null;
        await refreshSyncStatus();
        render();
      },
      async () => {
        tasks = await window.widget.disconnectFolder();
        await refreshSyncStatus();
        render();
      })
  );
  // Catch clicks in the drag area and the click-through margin, and close if focus is lost.
  popoverBackdrop = document.createElement('div');
  popoverBackdrop.className = 'choice-backdrop';
  popoverBackdrop.addEventListener('mousedown', hidePopover);
  window.addEventListener('blur', hideOnBlur);
  document.body.append(popoverBackdrop, popover);
  window.widget.setIgnoreMouseEvents(false, false);
  ignoringMouse = false;

  const rect = $('#sync-button').getBoundingClientRect();
  const box = popover.getBoundingClientRect();
  const center = rect.left + rect.width / 2;
  const left = Math.max(8, Math.min(center - box.width / 2, window.innerWidth - box.width - 8));
  popover.style.left = `${left}px`;
  popover.style.top = `${rect.bottom + 8}px`;
  popover.style.setProperty('--arrow', `${center - left}px`);
}

$('#sync-button').addEventListener('click', async () => {
  if (popover) { hidePopover(); return; }
  await refreshSyncStatus();
  showSyncPopover();
});

let choiceBox = null; // the Merge/Rewrite/Use cloud popup, kept clickable through the transparent margin

// Asked by the main process when connecting a cloud copy that already exists.
window.widget.onSyncAsk(({ cloudName }) => {
  hidePopover();
  const box = document.createElement('div');
  choiceBox = box;
  box.className = 'popover sync choice';
  box.setAttribute('role', 'dialog');

  const title = document.createElement('div');
  title.className = 'info';
  const heading = document.createElement('b');
  heading.textContent = `Connect ${cloudName}`;
  const sub = document.createElement('span');
  sub.textContent = 'If it already has tasks, what should Nook do?';
  title.append(heading, sub);
  box.append(title);

  // Clicking anywhere outside the popup counts as Cancel.
  // A transparent backdrop covers the whole window (including the drag area and the
  // click-through margin) so any click lands on it; losing focus cancels too.
  const backdrop = document.createElement('div');
  backdrop.className = 'choice-backdrop';
  backdrop.addEventListener('mousedown', () => answer(null));
  const onBlur = () => answer(null);
  const answer = (choice) => {
    window.removeEventListener('blur', onBlur);
    backdrop.remove();
    box.remove();
    choiceBox = null;
    window.widget.answerSyncAsk(choice);
  };
  window.addEventListener('blur', onBlur);
  const icons = {
    merge: '<path d="M6 3v6a6 6 0 0 0 6 6h6M18 3v6a6 6 0 0 1-6 6v6"/>',
    rewrite: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
    cloud: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
    cancel: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  const option = (label, hint, choice, quiet, icon) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = quiet ? 'quiet' : '';
    button.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</svg><div><b></b><span></span></div>`;
    button.querySelector('b').textContent = label;
    button.querySelector('span').textContent = hint;
    button.addEventListener('click', () => answer(choice));
    return button;
  };
  box.append(
    option('Merge', 'Keep both sets of tasks', 'merge', false, 'merge'),
    option('Rewrite', 'Replace the cloud with this device', 'rewrite', true, 'rewrite'),
    option('Use cloud', 'Replace this device with the cloud', 'cloud', true, 'cloud'),
    option('Cancel', '', null, true, 'cancel')
  );
  document.body.append(backdrop, box);
  window.widget.setIgnoreMouseEvents(false, false);
  ignoringMouse = false;

  const rect = $('#sync-button').getBoundingClientRect();
  const width = box.getBoundingClientRect().width;
  const center = rect.left + rect.width / 2;
  const left = Math.max(8, Math.min(center - width / 2, window.innerWidth - width - 8));
  box.style.left = `${left}px`;
  box.style.top = `${rect.bottom + 8}px`;
  box.style.setProperty('--arrow', `${center - left}px`);
  box.classList.add('below');
});

window.widget.onTasksChanged((updated) => {
  tasks = updated;
  editingId = null;
  render();
});

/* ---------- click-through for the transparent margin ---------- */

const shellEl = $('#shell');
let ignoringMouse = false;

document.addEventListener('mousemove', (event) => {
  if (choiceBox || popoverBackdrop) return; // the backdrop needs every click while the choice popup is open
  const targets = [shellEl.getBoundingClientRect()];
  if (popover) targets.push(popover.getBoundingClientRect());
  if (choiceBox) targets.push(choiceBox.getBoundingClientRect());
  const inside = targets.some((rect) =>
    event.clientX >= rect.left && event.clientX <= rect.right &&
    event.clientY >= rect.top && event.clientY <= rect.bottom
  );
  if (inside === ignoringMouse) {
    ignoringMouse = !inside;
    window.widget.setIgnoreMouseEvents(ignoringMouse, true);
  }
});

/* ---------- reminders ---------- */

function showReminderNotification(task, when) {
  try {
    // requireInteraction keeps it on screen until dismissed, instead of the ~5s auto-hide.
    new Notification(task.title, { body: when, silent: false, requireInteraction: true });
  } catch {
    // Notifications unsupported or denied — fail silently.
  }
}


function checkDayOfReminders() {
  const now = new Date();
  const todayKey = dateKey(now);
  let changed = false;
  tasks.forEach((task) => {
    if (!task.reminder?.enabled || !task.reminder.dayOf) return;
    if (!occursOn(task, todayKey)) return;
    const notified = task.notifiedDayOf || [];
    if (notified.includes(todayKey)) return;
    // A task's own time overrides the default 9am trigger for its "day of" reminder.
    const [hours, minutes] = task.time ? task.time.split(':').map(Number) : [9, 0];
    const triggerTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
    if (now < triggerTime) return;
    showReminderNotification(task, task.time ? `Today, ${formatTime(task.time)}` : 'Today');
    task.notifiedDayOf = [...notified, todayKey];
    changed = true;
  });
  if (changed) saveTasks();
}

function checkDayBeforeReminders() {
  const now = new Date();
  const todayKey = dateKey(now);
  const tomorrowKey = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  let changed = false;

  // Catch-up: today's task whose "day before, 9pm" notice never fired (e.g. the PC was off
  // past 9pm yesterday). By the time it's today, that window has passed — send it now instead
  // of silently losing it.
  tasks.forEach((task) => {
    if (!task.reminder?.enabled || !task.reminder.dayBefore) return;
    if (!occursOn(task, todayKey)) return;
    const notified = task.notifiedDayBefore || [];
    if (notified.includes(todayKey)) return;
    showReminderNotification(task, `Today, ${agendaDateFormatter.format(now)}`);
    task.notifiedDayBefore = [...notified, todayKey];
    changed = true;
  });

  if (now.getHours() >= 21) {
    tasks.forEach((task) => {
      if (!task.reminder?.enabled || !task.reminder.dayBefore) return;
      if (!occursOn(task, tomorrowKey)) return;
      const notified = task.notifiedDayBefore || [];
      if (notified.includes(tomorrowKey)) return;
      showReminderNotification(task, `Tomorrow, ${agendaDateFormatter.format(parseDateKey(tomorrowKey))}`);
      task.notifiedDayBefore = [...notified, tomorrowKey];
      changed = true;
    });
  }

  if (changed) saveTasks();
}

render();

window.widget.loadTasks().then((loaded) => {
  tasks = loaded;
  render();
  checkDayOfReminders();
  checkDayBeforeReminders();
  setInterval(() => {
    checkDayOfReminders();
    checkDayBeforeReminders();
  }, 60000);
});
