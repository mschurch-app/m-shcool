/* Read-only kiosk leaderboard. The server applies the existing device policy. */
(() => {
  let pending = false;
  window.loadPointsLeaderboard = async function () {
    const list = document.getElementById('points-board-list');
    const status = document.getElementById('points-board-status');
    const refresh = document.getElementById('points-board-refresh');
    if (!list || !status || pending) return;
    pending = true;
    refresh.disabled = true;
    status.textContent = '更新點數中…';
    try {
      const rows = await callMschoolApi('/kiosk/leaderboard');
      if (!Array.isArray(rows)) throw new Error('排行榜資料格式不正確');
      const items = rows.map(row => {
        const item = document.createElement('li');
        item.className = 'school-points-row';
        item.dataset.rank = String(row.rank);
        for (const [className, text] of [
          ['school-points-rank', String(row.rank)],
          ['school-points-name', row.name],
          ['school-points-value', `${Number(row.points) || 0} 點`]
        ]) {
          const span = document.createElement('span');
          span.className = className;
          span.textContent = text;
          item.append(span);
        }
        return item;
      });
      list.replaceChildren(...items);
      status.textContent = rows.length ? `更新於 ${new Date().toLocaleTimeString('zh-TW', {timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false})}・同點數並列` : '目前沒有在班學生的點數資料。';
    } catch (error) {
      list.replaceChildren();
      status.textContent = `點數暫時無法載入：${error.message || '請稍後按更新重試'}`;
    } finally {
      pending = false;
      refresh.disabled = false;
    }
  };
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('points-board-refresh')?.addEventListener('click', () => window.loadPointsLeaderboard());
    window.loadPointsLeaderboard();
  });
  setInterval(() => {
    if (!document.hidden && !document.getElementById('tab-checkin')?.classList.contains('hidden')) window.loadPointsLeaderboard();
  }, 60000);
})();
