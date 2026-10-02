(function () {
  'use strict';

  var KEY = 'prayjourney.v1';
  var WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  var LEVELS = { daily: '每日', weekly: '每週', monthly: '每月' };

  // ---------- 資料 ----------
  var state = load();

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.items)) return { items: s.items, log: s.log || {} };
    } catch (e) {}
    return { items: [], log: {} };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('儲存失敗，請檢查儲存空間'); }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- 日期 ----------
  function ymd(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function today() { return ymd(new Date()); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function fmtDate(s) { var d = parse(s); return (d.getMonth() + 1) + '月' + d.getDate() + '日（週' + WEEKDAYS[d.getDay()] + '）'; }

  // ---------- 排程 ----------
  // 每週事項固定排在某個星期幾（0-6）；每月事項固定排在某月幾號（1-28，確保每月都有）。
  // 沒做就算「漏掉」，不順延。
  function isLive(item, d) {
    if (d < item.created) return false;
    if (item.answeredDate && d >= item.answeredDate) return false;
    if (item.archivedDate && d >= item.archivedDate) return false;
    return true;
  }
  function scheduledOn(item, d) {
    if (!isLive(item, d)) return false;
    if (item.level === 'daily') return true;
    if (item.level === 'weekly') return parse(d).getDay() === item.slot;
    if (item.level === 'monthly') return parse(d).getDate() === item.slot;
    return false;
  }
  function prayedOn(item, d) { return (state.log[d] || []).indexOf(item.id) !== -1; }

  function autoSlot(level, exceptId) {
    var n = level === 'weekly' ? 7 : 28;
    var counts = [];
    for (var i = 0; i < n; i++) counts.push(0);
    state.items.forEach(function (it) {
      if (it.id === exceptId || it.level !== level || it.answeredDate || it.archivedDate) return;
      var idx = level === 'weekly' ? it.slot : it.slot - 1;
      if (counts[idx] !== undefined) counts[idx]++;
    });
    // 從今天開始找最少事項的日子，這樣第一件會排在今天
    var now = new Date();
    var start = level === 'weekly' ? now.getDay() : Math.min(now.getDate(), 28) - 1;
    var best = start;
    for (var k = 0; k < n; k++) {
      var j = (start + k) % n;
      if (counts[j] < counts[best]) best = j;
    }
    return level === 'weekly' ? best : best + 1;
  }
  function scheduleText(it) {
    if (it.level === 'daily') return '每天';
    if (it.level === 'weekly') return '每週' + WEEKDAYS[it.slot];
    return '每月' + it.slot + '日';
  }
  function missedRecent(days) {
    var t = today(), out = [];
    for (var i = days; i >= 1; i--) {
      var d = addDays(t, -i);
      var list = state.items.filter(function (it) { return scheduledOn(it, d) && !prayedOn(it, d); });
      if (list.length) out.push({ date: d, items: list });
    }
    return out;
  }

  // ---------- 工具 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function $(id) { return document.getElementById(id); }

  // ---------- 畫面 ----------
  var tab = 'today';
  var filter = 'all';
  var HIDE_KEY = 'prayjourney.hideAll';
  var hideAll = (function () { try { return localStorage.getItem(HIDE_KEY) !== '0'; } catch (e) { return true; } })();
  var revealedAll = null; // 全部事項頁目前展開的事項
  var revealed = null; // 今日頁目前展開的事項（只存在記憶體，離開就收起）

  function render() {
    ['today', 'all', 'settings'].forEach(function (t) { $('view-' + t).hidden = t !== tab; });
    document.querySelectorAll('.tabbar button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    $('fab').hidden = tab === 'settings';
    if (tab === 'today') renderToday();
    else if (tab === 'all') renderAll();
    else renderSettings();
  }

  function badge(it) {
    return '<span class="badge b-' + it.level + '">' + LEVELS[it.level] + '</span>';
  }

  function nowHM() {
    var n = new Date(), h = n.getHours(), m = n.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function renderToday() {
    var t = today(), now = nowHM();
    var all = state.items.filter(function (it) { return scheduledOn(it, t); });
    var pending = all.filter(function (it) { return !prayedOn(it, t); });
    var done = all.filter(function (it) { return prayedOn(it, t); });
    if (revealed && !pending.some(function (it) { return it.id === revealed; })) revealed = null;

    // 有指定時間的依時間排序，沒指定的放後面
    pending.sort(function (a, b) {
      if (a.time && b.time) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
      return a.time ? -1 : b.time ? 1 : 0;
    });

    var html = '<h1>今日祈禱</h1><p class="sub">' + fmtDate(t) + '</p>';

    if (!state.items.length) {
      html += '<div class="empty"><div class="big">🕊️</div><p>還沒有祈禱事項<br>點右下角的 ＋ 開始新增</p></div>';
    } else if (!all.length) {
      html += '<div class="empty"><div class="big">☀️</div><p>今天沒有安排的祈禱事項<br>安靜與神同在也很好</p></div>';
    } else {
      var pct = Math.round(done.length / all.length * 100);
      html += '<div class="card progress"><b>' + done.length + ' / ' + all.length + '</b><div class="bar"><i style="width:' + pct + '%"></i></div></div>';
      if (!pending.length) html += '<div class="empty"><div class="big">🌸</div><p>今天的祈禱都完成了<br>感謝神</p></div>';
      pending.forEach(function (it) {
        var open = revealed === it.id;
        var later = it.time && it.time > now;
        html += '<div class="card pray' + (open ? ' open' : '') + (later ? ' later' : '') + '" data-reveal="' + it.id + '">' +
          '<div class="pray-head"><span class="mask">' + (open ? '' : '• • • • • •') + '</span>' +
          (it.time ? '<span class="time">' + it.time + '</span>' : '') + '</div>';
        if (open) {
          html += '<div class="title">' + esc(it.title) + '</div>' +
            (it.note ? '<div class="note">' + esc(it.note) + '</div>' : '') +
            '<button class="btn block done-btn" data-done="' + it.id + '">禱告完了</button>';
        }
        html += '<div class="meta">' + badge(it) + (later ? '<span class="badge b-plain">稍後</span>' : '') + '</div></div>';
      });
      if (done.length) {
        html += '<details class="card missed"><summary>今天已完成 ' + done.length + ' 件</summary><ul class="undo">' +
          done.map(function (it) { return '<li><span>已禱告 ✓</span><button class="edit-btn" data-undo="' + it.id + '">復原</button></li>'; }).join('') +
          '</ul></details>';
      }
    }

    var missed = missedRecent(7);
    if (missed.length) {
      var total = missed.reduce(function (n, m) { return n + m.items.length; }, 0);
      html += '<details class="card missed"><summary>最近 7 天漏掉 ' + total + ' 件</summary><ul>' +
        missed.reverse().map(function (m) {
          return '<li>' + fmtDate(m.date) + '：漏掉 ' + m.items.length + ' 件</li>';
        }).join('') + '</ul></details>';
    }
    $('view-today').innerHTML = html;
  }

  function renderAll() {
    var live = state.items.filter(function (it) { return !it.archivedDate; });
    var answered = live.filter(function (it) { return it.answeredDate; }).length;
    var filters = [['all', '全部'], ['open', '未應允'], ['answered', '已應允'], ['archived', '封存']];

    var list = state.items.filter(function (it) {
      if (filter === 'archived') return !!it.archivedDate;
      if (it.archivedDate) return false;
      if (filter === 'open') return !it.answeredDate;
      if (filter === 'answered') return !!it.answeredDate;
      return true;
    }).sort(function (a, b) { return a.created < b.created ? 1 : -1; });

    var html = '<h1>全部事項</h1><p class="sub">記錄神的回應</p>' +
      '<div class="card stat"><div><div class="num">' + answered + ' <small>/ ' + live.length + '</small></div><small>已應允的禱告</small></div><div style="font-size:34px">🌷</div></div>' +
      '<div class="chips">' + filters.map(function (f) {
        return '<button class="chip' + (filter === f[0] ? ' on' : '') + '" data-filter="' + f[0] + '">' + f[1] + '</button>';
      }).join('') + '</div>';

    if (!list.length) {
      html += '<div class="empty"><div class="big">🍃</div><p>' + (state.items.length ? '這個分類還沒有事項' : '還沒有祈禱事項') + '</p></div>';
    }
    list.forEach(function (it) {
      var hidden = hideAll && revealedAll !== it.id;
      html += '<div class="card item">' +
        '<input type="checkbox" class="chk gold" data-answer="' + it.id + '"' + (it.answeredDate ? ' checked' : '') + ' aria-label="已應允"' + (it.archivedDate ? ' disabled' : '') + '>' +
        '<div class="body"' + (hideAll ? ' data-reveal-all="' + it.id + '"' : '') + '>' +
        (hidden ? '<div class="title mask-text">• • • • • •</div>' :
          '<div class="title">' + esc(it.title) + '</div>' +
          (it.note ? '<div class="note">' + esc(it.note) + '</div>' : '') +
          (it.answeredDate && it.answerNote ? '<div class="note">✨ ' + esc(it.answerNote) + '</div>' : '')) +
        '<div class="meta">' + badge(it) + '<span class="badge b-plain">' + scheduleText(it) + (it.time ? ' ' + it.time : '') + '</span>' +
        (it.answeredDate ? '<span class="badge b-ans">已應允 ' + it.answeredDate + '</span>' : '') + '</div></div>' +
        '<button class="edit-btn" data-edit="' + it.id + '">編輯</button></div>';
    });
    $('view-all').innerHTML = html;
  }

  function renderSettings() {
    $('view-settings').innerHTML = '<h1>設定</h1><p class="sub">資料只存在這支手機的 Safari 裡</p>' +
      '<div class="card"><label class="row switch"><input type="checkbox" class="chk" id="hide-all"' + (hideAll ? ' checked' : '') + '><span><span class="title">隱藏「全部事項」內容</span><span class="hint" style="display:block;margin:0">點一下事項才會顯示</span></span></label></div>' +
      '<div class="card"><div class="title">備份資料</div>' +
      '<p class="hint">清除 Safari 網站資料會遺失紀錄，建議定期匯出備份。</p>' +
      '<div class="actions"><button class="btn" id="export">匯出備份</button>' +
      '<button class="btn ghost" id="import">匯入備份</button></div>' +
      '<input type="file" id="file" accept="application/json,.json" hidden></div>' +
      '<div class="card"><div class="title">使用說明</div>' +
      '<p class="hint">每日：每天都會出現。<br>今日頁預設遮住內容，點開才看得到，按「禱告完了」後就會收起。<br>每週：自動平均排在週一到週日其中一天（可手動調整）。<br>每月：自動平均排在每月 1–28 日其中一天。<br>當天沒有勾選就算漏掉，不會順延。<br>已應允的事項不再出現在今日清單。</p></div>';
  }

  // ---------- 編輯面板 ----------
  function openSheet(html) {
    $('sheet').innerHTML = html;
    $('sheet').hidden = false; $('sheet-backdrop').hidden = false;
    $('sheet').scrollTop = 0;
  }
  function closeSheet() { $('sheet').hidden = true; $('sheet-backdrop').hidden = true; $('sheet').innerHTML = ''; }

  function slotOptions(level, current) {
    var html = '<option value="auto">自動安排</option>';
    if (level === 'weekly') for (var i = 0; i < 7; i++) html += '<option value="' + i + '"' + (current === i ? ' selected' : '') + '>每週' + WEEKDAYS[i] + '</option>';
    if (level === 'monthly') for (var j = 1; j <= 28; j++) html += '<option value="' + j + '"' + (current === j ? ' selected' : '') + '>每月 ' + j + ' 日</option>';
    return html;
  }

  function openEditor(id) {
    var it = id ? state.items.filter(function (x) { return x.id === id; })[0] : null;
    var level = it ? it.level : 'daily';
    var keepSlot = it && it.level !== 'daily' ? it.slot : null;

    var html = '<h3>' + (it ? '編輯事項' : '新增祈禱事項') + '</h3>' +
      '<div class="field"><label>祈禱事項</label><input type="text" id="f-title" maxlength="100" placeholder="例如：為家人的平安" value="' + esc(it ? it.title : '') + '"></div>' +
      '<div class="field"><label>備註（選填）</label><textarea id="f-note" placeholder="細節、經文、代禱對象⋯">' + esc(it ? it.note : '') + '</textarea></div>' +
      '<div class="field"><label>提醒頻率</label><div class="seg" id="f-level">' +
      ['daily', 'weekly', 'monthly'].map(function (l) { return '<button type="button" data-level="' + l + '"' + (l === level ? ' class="on"' : '') + '>' + LEVELS[l] + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="field" id="f-slot-wrap" ' + (level === 'daily' ? 'hidden' : '') + '><label>排在哪一天</label><select id="f-slot">' + slotOptions(level, keepSlot) + '</select>' +
      '<p class="hint">自動安排會把事項平均分散，確保每週／每月都會輪到。</p></div>';

    html += '<div class="field"><label>提醒時間（選填，用來排序今日清單）</label><div class="row"><input type="time" id="f-time" value="' + esc(it && it.time || '') + '"><button type="button" class="btn ghost" id="f-time-clear">不指定</button></div></div>';

    if (it) {
      html += '<div class="ans-box"><div class="row"><input type="checkbox" class="chk gold" id="f-ans"' + (it.answeredDate ? ' checked' : '') + '><label for="f-ans">神已應允</label></div>' +
        '<div id="f-ans-wrap" ' + (it.answeredDate ? '' : 'hidden') + '>' +
        '<div class="field" style="margin-top:12px"><label>應允日期</label><input type="date" id="f-ans-date" value="' + esc(it.answeredDate || today()) + '"></div>' +
        '<div class="field" style="margin-bottom:0"><label>神怎麼應允（選填）</label><textarea id="f-ans-note" placeholder="記下這份見證">' + esc(it.answerNote || '') + '</textarea></div></div></div>';
    }

    html += '<div class="actions"><button class="btn ghost" id="f-cancel">取消</button><button class="btn" id="f-save">儲存</button></div>';
    if (it) {
      html += '<div class="actions"><button class="btn ghost" id="f-archive">' + (it.archivedDate ? '取消封存' : '封存') + '</button>' +
        '<button class="btn danger" id="f-delete">刪除</button></div>';
    }
    openSheet(html);

    var sheet = $('sheet');
    sheet.querySelectorAll('#f-level button').forEach(function (b) {
      b.onclick = function () {
        level = b.dataset.level;
        sheet.querySelectorAll('#f-level button').forEach(function (x) { x.classList.toggle('on', x === b); });
        $('f-slot-wrap').hidden = level === 'daily';
        $('f-slot').innerHTML = slotOptions(level, it && it.level === level ? keepSlot : null);
      };
    });
    if ($('f-ans')) $('f-ans').onchange = function () { $('f-ans-wrap').hidden = !this.checked; };
    $('f-time-clear').onclick = function () { $('f-time').value = ''; };
    $('f-cancel').onclick = closeSheet;
    $('f-save').onclick = function () {
      var title = $('f-title').value.trim();
      if (!title) { $('f-title').focus(); toast('請輸入祈禱事項'); return; }
      var target = it || { id: uid(), created: today() };
      target.title = title;
      target.note = $('f-note').value.trim();
      target.level = level;
      target.time = $('f-time').value || '';
      if (level === 'daily') target.slot = null;
      else {
        var v = $('f-slot').value;
        target.slot = v === 'auto' ? autoSlot(level, target.id) : +v;
      }
      if (it) {
        if ($('f-ans').checked) {
          target.answeredDate = $('f-ans-date').value || today();
          target.answerNote = $('f-ans-note').value.trim();
        } else { delete target.answeredDate; delete target.answerNote; }
      } else state.items.push(target);
      save(); closeSheet(); render();
      toast(it ? '已儲存' : '已新增，願神垂聽');
    };
    if (it) {
      $('f-archive').onclick = function () {
        if (it.archivedDate) delete it.archivedDate; else it.archivedDate = today();
        save(); closeSheet(); render(); toast(it.archivedDate ? '已封存' : '已取消封存');
      };
      $('f-delete').onclick = function () {
        if (!confirm('確定要刪除「' + it.title + '」嗎？此動作無法復原。\n（不想再禱告可改用「封存」）')) return;
        state.items = state.items.filter(function (x) { return x.id !== it.id; });
        save(); closeSheet(); render(); toast('已刪除');
      };
    }
    if (!it) setTimeout(function () { $('f-title').focus(); }, 50);
  }

  // ---------- 事件 ----------
  document.addEventListener('click', function (e) {
    var t = e.target;
    var tabBtn = t.closest('.tabbar button');
    if (tabBtn) { revealed = null; revealedAll = null; tab = tabBtn.dataset.tab; render(); window.scrollTo(0, 0); return; }
    if (t.closest('#fab')) { openEditor(null); return; }
    if (t === $('sheet-backdrop')) { closeSheet(); return; }
    var dn = t.closest('[data-done]');
    if (dn) { markPrayed(dn.dataset.done, true); revealed = null; renderToday(); toast('感謝神，已完成'); return; }
    var un = t.closest('[data-undo]');
    if (un) { markPrayed(un.dataset.undo, false); renderToday(); return; }
    var rv = t.closest('[data-reveal]');
    if (rv) { revealed = revealed === rv.dataset.reveal ? null : rv.dataset.reveal; renderToday(); return; }
    var ra = t.closest('[data-reveal-all]');
    if (ra) { revealedAll = revealedAll === ra.dataset.revealAll ? null : ra.dataset.revealAll; renderAll(); return; }
    var chip = t.closest('[data-filter]');
    if (chip) { filter = chip.dataset.filter; renderAll(); return; }
    var edit = t.closest('[data-edit]');
    if (edit) { openEditor(edit.dataset.edit); return; }
    if (t.id === 'export') { exportData(); return; }
    if (t.id === 'import') { $('file').click(); return; }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.answer) {
      var it = state.items.filter(function (x) { return x.id === t.dataset.answer; })[0];
      if (!it) return;
      if (t.checked) { it.answeredDate = today(); save(); renderAll(); toast('感謝神！可點「編輯」記下見證'); }
      else { delete it.answeredDate; delete it.answerNote; save(); renderAll(); }
    } else if (t.id === 'hide-all') {
      hideAll = t.checked; revealedAll = null;
      try { localStorage.setItem(HIDE_KEY, hideAll ? '1' : '0'); } catch (err) {}
    } else if (t.id === 'file') {
      importData(t.files[0]); t.value = '';
    }
  });

  function markPrayed(id, on) {
    var d = today(), arr = state.log[d] || (state.log[d] = []), i = arr.indexOf(id);
    if (on && i === -1) arr.push(id);
    if (!on && i !== -1) arr.splice(i, 1);
    save();
  }

  function exportData() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'prayjourney-' + today() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已匯出');
  }
  function importData(file) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var s = JSON.parse(r.result);
        if (!s || !Array.isArray(s.items)) throw new Error('bad');
        if (!confirm('匯入會取代目前所有資料，確定嗎？')) return;
        state = { items: s.items, log: s.log || {} };
        save(); render(); toast('已匯入');
      } catch (err) { toast('檔案格式不正確'); }
    };
    r.readAsText(file);
  }

  // 回到 app 時（跨日）重新整理
  document.addEventListener('visibilitychange', function () { revealed = null; revealedAll = null; if (!document.hidden) render(); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
  render();
})();
