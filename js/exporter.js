/**
 * exporter.js - 数据导出模块
 * 支持按周/月导出日程和里程数据，格式为 JSON/CSV/HTML
 */

const Exporter = {

  /**
   * 导出数据
   * @param {Object} config - 导出配置
   * @param {Array} events - 所有事件
   * @param {Array} mileages - 所有里程记录
   * @param {Object} oilSettings - 油价设置 { pricePerLiter, consumptionPer100km }
   * @returns {Object} 导出结果 { filename, content, mime }
   */
  export(config, events, mileages, oilSettings) {
    const { range, weekValue, monthValue, includeSchedule, includeMileage, format } = config;
    const oil = oilSettings || { pricePerLiter: 8.0, consumptionPer100km: 8.0 };
    const costPerKm = oil.pricePerLiter * oil.consumptionPer100km / 100;

    // 确定日期范围
    const dateRange = this.getDateRange(range, weekValue, monthValue);

    // 过滤数据
    const filteredEvents = includeSchedule
      ? events.filter(e => e.date >= dateRange.start && e.date <= dateRange.end)
      : [];
    const filteredMileages = includeMileage
      ? mileages.filter(m => m.date >= dateRange.start && m.date <= dateRange.end)
      : [];

    // 排序
    filteredEvents.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.startTime || '').localeCompare(b.startTime || '');
    });
    filteredMileages.sort((a, b) => a.date.localeCompare(b.date));

    // 生成文件名
    const rangeLabel = this.getRangeLabel(range, dateRange);
    const ext = format;
    const filename = `日程里程_${rangeLabel}.${ext}`;

    // 按格式生成内容
    let content, mime;
    if (format === 'json') {
      content = this.exportJSON(filteredEvents, filteredMileages, dateRange, costPerKm);
      mime = 'application/json';
    } else if (format === 'csv') {
      content = this.exportCSV(filteredEvents, filteredMileages, includeSchedule, includeMileage, costPerKm);
      mime = 'text/csv;charset=utf-8';
    } else if (format === 'html') {
      content = this.exportHTML(filteredEvents, filteredMileages, dateRange, rangeLabel, costPerKm);
      mime = 'text/html';
    }

    return {
      filename,
      content,
      mime,
      stats: {
        eventCount: filteredEvents.length,
        mileageCount: filteredMileages.length,
        totalKm: filteredMileages.reduce((sum, m) => sum + m.km, 0),
        totalCost: filteredMileages.reduce((sum, m) => sum + m.km * costPerKm, 0)
      }
    };
  },

  /**
   * 获取日期范围
   */
  getDateRange(range, weekValue, monthValue) {
    if (range === 'all') {
      return { start: '0000-01-01', end: '9999-12-31' };
    }

    if (range === 'week' && weekValue) {
      // weekValue format: "2026-W29"
      const [year, week] = weekValue.split('-W');
      const date = this.getWeekStart(parseInt(year), parseInt(week));
      const end = new Date(date);
      end.setDate(end.getDate() + 6);
      return {
        start: this.formatDate(date),
        end: this.formatDate(end)
      };
    }

    if (range === 'month' && monthValue) {
      // monthValue format: "2026-07"
      const [year, month] = monthValue.split('-');
      const start = new Date(parseInt(year), parseInt(month) - 1, 1);
      const end = new Date(parseInt(year), parseInt(month), 0);
      return {
        start: this.formatDate(start),
        end: this.formatDate(end)
      };
    }

    // 默认本周
    const today = new Date();
    const start = this.getWeekStart(today.getFullYear(), this.getWeekNumber(today));
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return {
      start: this.formatDate(start),
      end: this.formatDate(end)
    };
  },

  getRangeLabel(range, dateRange) {
    if (range === 'all') return '全部数据';
    if (range === 'week') return `${dateRange.start}_至_${dateRange.end}`;
    if (range === 'month') return dateRange.start.substring(0, 7);
    return dateRange.start;
  },

  /**
   * JSON 格式导出
   */
  exportJSON(events, mileages, dateRange, costPerKm) {
    const totalKm = mileages.reduce((sum, m) => sum + m.km, 0);
    const totalCost = totalKm * costPerKm;
    const data = {
      version: '1.1',
      exportedAt: new Date().toISOString(),
      dateRange: dateRange,
      oilSettings: {
        costPerKm: costPerKm.toFixed(4),
        assumption: '油费 = 里程(km) × 油价(元/升) × 油耗(升/百公里) / 100'
      },
      summary: {
        totalEvents: events.length,
        totalMileages: mileages.length,
        totalKm: totalKm,
        totalCost: totalCost.toFixed(2)
      },
      events: events,
      mileages: mileages.map(m => ({ ...m, cost: (m.km * costPerKm).toFixed(2) }))
    };
    return JSON.stringify(data, null, 2);
  },

  /**
   * CSV 格式导出
   */
  exportCSV(events, mileages, includeSchedule, includeMileage, costPerKm) {
    let csv = '\uFEFF'; // BOM for Excel UTF-8

    if (includeSchedule) {
      csv += '=== 日程数据 ===\n';
      csv += '日期,星期,开始时间,结束时间,标题,地点,备注\n';
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      for (const ev of events) {
        const date = new Date(ev.date);
        const weekday = weekdays[date.getDay()];
        csv += [
          ev.date,
          weekday,
          ev.startTime || '',
          ev.endTime || '',
          this.escapeCSV(ev.title),
          this.escapeCSV(ev.location || ''),
          this.escapeCSV(ev.description || '')
        ].join(',') + '\n';
      }
      csv += '\n';
    }

    if (includeMileage) {
      csv += '=== 里程数据 ===\n';
      csv += `日期,星期,地点,里程(km),油费(元),备注\n`;
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      for (const m of mileages) {
        const date = new Date(m.date);
        const weekday = weekdays[date.getDay()];
        csv += [
          m.date,
          weekday,
          this.escapeCSV(m.location),
          m.km,
          (m.km * costPerKm).toFixed(2),
          this.escapeCSV(m.notes || '')
        ].join(',') + '\n';
      }
      csv += '\n';

      // 统计汇总
      const totalKm = mileages.reduce((sum, m) => sum + m.km, 0);
      const totalCost = totalKm * costPerKm;
      csv += '=== 里程统计 ===\n';
      csv += `总里程,${totalKm} km\n`;
      csv += `总油费,${totalCost.toFixed(2)} 元\n`;
      csv += `记录数,${mileages.length} 条\n`;
      csv += `每公里成本,${costPerKm.toFixed(4)} 元/km\n`;
      if (mileages.length > 0) {
        csv += `平均里程,${(totalKm / mileages.length).toFixed(1)} km/次\n`;
      }
    }

    return csv;
  },

  /**
   * HTML 报表导出
   */
  exportHTML(events, mileages, dateRange, rangeLabel, costPerKm) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const totalKm = mileages.reduce((sum, m) => sum + m.km, 0);
    const totalCost = totalKm * costPerKm;

    let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>日程里程报表 - ${rangeLabel}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Noto Sans SC', -apple-system, sans-serif; background: #f8fafc; color: #1e293b; padding: 24px; }
.report-header { text-align: center; margin-bottom: 32px; }
.report-title { font-size: 24px; font-weight: 700; color: #1e293b; }
.report-range { font-size: 14px; color: #64748b; margin-top: 4px; }
.report-meta { font-size: 12px; color: #94a3b8; margin-top: 8px; }
.section { background: white; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.section-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #e2e8f0; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 24px; }
.stat-card { background: #f1f5f9; border-radius: 8px; padding: 16px; text-align: center; }
.stat-value { font-size: 24px; font-weight: 700; color: #6366f1; }
.stat-label { font-size: 12px; color: #64748b; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; }
th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-size: 13px; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; }
td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
tr:hover td { background: #f8fafc; }
.event-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
@media print { .section { break-inside: avoid; } }
</style>
</head>
<body>

<div class="report-header">
  <div class="report-title">🗓 日程里程报表</div>
  <div class="report-range">${rangeLabel}</div>
  <div class="report-meta">生成时间：${new Date().toLocaleString('zh-CN')}</div>
</div>

<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-value">${events.length}</div>
    <div class="stat-label">日程总数</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${mileages.length}</div>
    <div class="stat-label">里程记录</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${totalKm}</div>
    <div class="stat-label">总里程(km)</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">¥${totalCost.toFixed(2)}</div>
    <div class="stat-label">总油费(元)</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${mileages.length > 0 ? (totalKm / mileages.length).toFixed(1) : 0}</div>
    <div class="stat-label">平均里程(km)</div>
  </div>
</div>
`;

    if (events.length > 0) {
      html += `
<div class="section">
  <div class="section-title">📅 日程明细</div>
  <table>
    <thead>
      <tr><th>日期</th><th>星期</th><th>时间</th><th>标题</th><th>地点</th><th>备注</th></tr>
    </thead>
    <tbody>
      ${events.map(ev => {
        const date = new Date(ev.date);
        const weekday = weekdays[date.getDay()];
        return `<tr>
          <td>${ev.date}</td>
          <td>${weekday}</td>
          <td>${ev.startTime || ''} - ${ev.endTime || ''}</td>
          <td><span class="event-dot" style="background:${ev.color || '#6366f1'}"></span>${ev.title}</td>
          <td>${ev.location || '-'}</td>
          <td>${ev.description || '-'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>
`;
    }

    if (mileages.length > 0) {
      // 按地点统计
      const locationStats = {};
      for (const m of mileages) {
        if (!locationStats[m.location]) {
          locationStats[m.location] = { count: 0, km: 0 };
        }
        locationStats[m.location].count++;
        locationStats[m.location].km += m.km;
      }

      html += `
<div class="section">
  <div class="section-title">🚗 里程明细</div>
  <table>
    <thead>
      <tr><th>日期</th><th>星期</th><th>地点</th><th>里程(km)</th><th>油费(元)</th><th>备注</th></tr>
    </thead>
    <tbody>
      ${mileages.map(m => {
        const date = new Date(m.date);
        const weekday = weekdays[date.getDay()];
        return `<tr>
          <td>${m.date}</td>
          <td>${weekday}</td>
          <td>${m.location}</td>
          <td>${m.km}</td>
          <td>¥${(m.km * costPerKm).toFixed(2)}</td>
          <td>${m.notes || '-'}</td>
        </tr>`;
      }).join('')}
    </tbody>
    <tfoot>
      <tr style="font-weight:600; background:#f1f5f9;">
        <td colspan="3">合计</td>
        <td>${totalKm} km</td>
        <td>¥${totalCost.toFixed(2)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</div>

<div class="section">
  <div class="section-title">📊 地点统计</div>
  <table>
    <thead>
      <tr><th>地点</th><th>次数</th><th>总里程(km)</th><th>总油费(元)</th><th>平均里程(km)</th></tr>
    </thead>
    <tbody>
      ${Object.entries(locationStats).map(([loc, stats]) => {
        return `<tr>
          <td>${loc}</td>
          <td>${stats.count}</td>
          <td>${stats.km.toFixed(1)}</td>
          <td>¥${(stats.km * costPerKm).toFixed(2)}</td>
          <td>${(stats.km / stats.count).toFixed(1)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>
`;
    }

    if (events.length === 0 && mileages.length === 0) {
      html += '<div class="section"><p style="text-align:center; color:#94a3b8; padding:40px;">该时间段内暂无数据</p></div>';
    }

    html += `
</body>
</html>`;

    return html;
  },

  /**
   * CSV 转义
   */
  escapeCSV(value) {
    if (value == null) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  },

  /**
   * 获取ISO周的第一天（周一）
   */
  getWeekStart(year, week) {
    const date = new Date(year, 0, 1);
    const dayOfWeek = date.getDay() || 7;
    date.setDate(date.getDate() + (1 - dayOfWeek) + (week - 1) * 7);
    return date;
  },

  /**
   * 获取ISO周数
   */
  getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  },

  formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  /**
   * 触发文件下载
   */
  download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }
};

// Export to global
window.Exporter = Exporter;
