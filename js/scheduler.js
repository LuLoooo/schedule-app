/**
 * scheduler.js - 智能排程引擎
 * 分析日历空闲时段，推荐可用时间槽
 */

const Scheduler = {

  // 工作时间设置
  WORK_SLOTS: [
    { start: '09:00', end: '12:00' },  // 上午
    { start: '14:00', end: '18:00' },  // 下午
  ],

  /**
   * 查找空闲时段
   * @param {Array} events - 现有事件列表
   * @param {number} durationMinutes - 需要的时长（分钟）
   * @param {Date} baseDate - 基准日期
   * @param {number} searchDays - 搜索天数（默认7天）
   * @returns {Array} 建议的时间槽列表
   */
  findFreeSlots(events, durationMinutes, baseDate, searchDays) {
    searchDays = searchDays || 7;
    baseDate = baseDate || new Date();
    const today = new Date(baseDate);
    today.setHours(0, 0, 0, 0);

    const now = new Date();
    const suggestions = [];

    for (let i = 0; i < searchDays; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dateStr = this.formatDate(date);
      const weekday = date.getDay();

      // 跳过周末（但如果没有其他选择，也考虑周末）
      const isWeekend = weekday === 0 || weekday === 6;

      // 获取当天已有事件
      const dayEvents = events
        .filter(e => e.date === dateStr && !e.allDay)
        .map(e => ({
          start: this.timeToMinutes(e.startTime),
          end: this.timeToMinutes(e.endTime)
        }))
        .sort((a, b) => a.start - b.start);

      // 在每个工作时段中找空闲
      for (const slot of this.WORK_SLOTS) {
        const slotStart = this.timeToMinutes(slot.start);
        const slotEnd = this.timeToMinutes(slot.end);

        // 过滤出当前时段内的事件
        const slotEvents = dayEvents.filter(e =>
          e.end > slotStart && e.start < slotEnd
        );

        // 找空闲段
        const freeSlots = this.findGaps(slotStart, slotEnd, slotEvents, durationMinutes);

        for (const free of freeSlots) {
          // 如果是今天，跳过已过去的时间
          if (i === 0) {
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            if (free.end <= nowMinutes) continue;
            // 调整开始时间到当前时间之后
            if (free.start < nowMinutes + 30) {
              const adjustedStart = nowMinutes + 30;
              if (adjustedStart + durationMinutes > free.end) continue;
              free.start = adjustedStart;
            }
          }

          suggestions.push({
            date: dateStr,
            dateObj: new Date(date),
            start: this.minutesToTime(free.start),
            end: this.minutesToTime(free.start + durationMinutes),
            slotEnd: this.minutesToTime(free.end),
            durationMinutes: durationMinutes,
            isWeekend: isWeekend,
            score: this.scoreSlot(date, free.start, i, isWeekend)
          });
        }
      }
    }

    // 按分数排序，优先工作日和上午
    suggestions.sort((a, b) => b.score - a.score);

    // 返回前5个建议，且尽量分散在不同日期
    const result = [];
    const usedDates = new Set();
    const MAX_SUGGESTIONS = 5;

    // 先取每个日期的最佳建议
    for (const s of suggestions) {
      if (!usedDates.has(s.date)) {
        result.push(s);
        usedDates.add(s.date);
        if (result.length >= MAX_SUGGESTIONS) break;
      }
    }

    // 如果还不够，补充其他建议
    if (result.length < 3) {
      for (const s of suggestions) {
        if (!result.includes(s)) {
          result.push(s);
          if (result.length >= MAX_SUGGESTIONS) break;
        }
      }
    }

    // 为每个建议添加标签
    return result.map(s => ({
      ...s,
      dateLabel: this.formatDateLabel(s.dateObj),
      durationLabel: this.formatDuration(s.durationMinutes)
    }));
  },

  /**
   * 在一个时段内找空闲间隙
   */
  findGaps(slotStart, slotEnd, events, minDuration) {
    const gaps = [];
    let cursor = slotStart;

    for (const ev of events) {
      if (ev.start > cursor) {
        const gapEnd = Math.min(ev.start, slotEnd);
        if (gapEnd - cursor >= minDuration) {
          gaps.push({ start: cursor, end: gapEnd });
        }
      }
      cursor = Math.max(cursor, ev.end);
    }

    // 最后一段
    if (slotEnd - cursor >= minDuration) {
      gaps.push({ start: cursor, end: slotEnd });
    }

    return gaps;
  },

  /**
   * 给时间槽打分（越高越好）
   */
  scoreSlot(date, startMinutes, dayOffset, isWeekend) {
    let score = 100;

    // 工作日加分
    if (!isWeekend) score += 20;

    // 越近的日期加分
    score -= dayOffset * 5;

    // 上午时段加分（9-11点最优）
    if (startMinutes >= 540 && startMinutes <= 660) { // 9:00-11:00
      score += 15;
    } else if (startMinutes >= 660 && startMinutes <= 720) { // 11:00-12:00
      score += 5;
    } else if (startMinutes >= 840 && startMinutes <= 960) { // 14:00-16:00
      score += 10;
    } else if (startMinutes >= 960) { // 16:00之后
      score += 3;
    }

    return score;
  },

  // ==================== Utils ====================

  timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + (m || 0);
  },

  minutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  },

  formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  formatDateLabel(date) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));

    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';

    return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`;
  },

  formatDuration(minutes) {
    if (minutes >= 60) {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
    }
    return `${minutes}分钟`;
  }
};

// Export to global
window.Scheduler = Scheduler;
