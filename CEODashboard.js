// ============================================================
// BLC CEO DASHBOARD - APPS SCRIPT BACKEND
// File: CEODashboard.gs
// Do NOT put this in Code.gs - save as a separate file
// doGet() is already in Code.gs - do not duplicate it here
// ============================================================

/**
 * Master function: reads MASTER_JOB_DATABASE and computes all CEO KPIs.
 * Called by doGet() in Code.gs when page=ceo and action=getCEODashboard.
 */
function buildCEODashboardData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = ss.getSheetByName(CONFIG.sheets.masterJob);
  var clientSheet = ss.getSheetByName(CONFIG.sheets.clientMaster);

  var lastRow = masterSheet.getLastRow();
  if (lastRow < 2) return getEmptyDashboardData();

  var data = masterSheet.getRange(2, 1, lastRow - 1, 42).getValues();

  var C = {
    jobNumber:     CONFIG.masterCols.jobNumber - 1,
    clientCode:    CONFIG.masterCols.clientCode - 1,
    designer:      CONFIG.masterCols.designerName - 1,
    productType:   CONFIG.masterCols.productType - 1,
    status:        CONFIG.masterCols.status - 1,
    allocatedDate: CONFIG.masterCols.allocatedDate - 1,
    totalHours:    CONFIG.masterCols.totalBillableHours - 1,
    reworkMajor:   CONFIG.masterCols.reworkHoursMajor - 1,
    reworkMinor:   CONFIG.masterCols.reworkHoursMinor - 1,
    billingPeriod: CONFIG.masterCols.billingPeriod - 1,
    billedFlag:    CONFIG.masterCols.billedFlag - 1,
    reworkFlag:    CONFIG.masterCols.reworkFlag - 1,
    reworkCount:   CONFIG.masterCols.reworkCount - 1,
    isTest:        CONFIG.masterCols.isTest - 1
  };

  var periods = getCurrentAndLastPeriod();
  var currentPeriod = periods.currentPeriod;
  var lastPeriod = periods.lastPeriod;

  // Filter out test jobs
  var liveJobs = data.filter(function(row) {
    var isTest = String(row[C.isTest]).trim().toLowerCase();
    var jobNum = String(row[C.jobNumber]).trim();
    return isTest !== 'yes' && jobNum.indexOf('TEST-') !== 0;
  });

  var activeStatuses = [
    CONFIG.status.allocated,
    CONFIG.status.pickedUp,
    CONFIG.status.inDesign,
    CONFIG.status.submittedForQC,
    CONFIG.status.qcInProgress,
    CONFIG.status.reworkMajor,
    CONFIG.status.reworkMinor,
    CONFIG.status.waitingReQC,
    CONFIG.status.waitingSpotCheck,
    CONFIG.status.spotCheckProgress,
    CONFIG.status.onHold
  ];
  var completedStatus = CONFIG.status.completed;
  var billedStatus = CONFIG.status.completed; // no separate billed status in your system
  var currentJobs = liveJobs.filter(function(r) {
    return String(r[C.billingPeriod]).trim() === currentPeriod;
  });
  var lastJobs = liveJobs.filter(function(r) {
    return String(r[C.billingPeriod]).trim() === lastPeriod;
  });

  var currentCompleted = currentJobs.filter(function(r) {
    var s = String(r[C.status]).trim();
    return s === completedStatus || s === billedStatus;
  });
  var lastCompleted = lastJobs.filter(function(r) {
    var s = String(r[C.status]).trim();
    return s === completedStatus || s === billedStatus;
  });

  var totalHoursCurrent = currentCompleted.reduce(function(s, r) {
    return s + (Number(r[C.totalHours]) || 0);
  }, 0);
  var totalHoursLast = lastCompleted.reduce(function(s, r) {
    return s + (Number(r[C.totalHours]) || 0);
  }, 0);

  var inProgress = liveJobs.filter(function(r) {
    return activeStatuses.indexOf(String(r[C.status]).trim()) !== -1;
  });

  // Rework
  var reworkJobs = currentCompleted.filter(function(r) {
    return String(r[C.reworkFlag]).trim().toLowerCase() === 'yes';
  });
  var majorRework = currentJobs.filter(function(r) {
    return String(r[C.status]).trim() === CONFIG.status.reworkMajor;
  });
  var minorRework = currentJobs.filter(function(r) {
    return String(r[C.status]).trim() === CONFIG.status.reworkMinor;
  });
  var reworkHoursTotal = currentCompleted.reduce(function(s, r) {
    return s + (Number(r[C.reworkMajor]) || 0) + (Number(r[C.reworkMinor]) || 0);
  }, 0);
  var reworkRate = currentCompleted.length > 0
    ? (reworkJobs.length / currentCompleted.length * 100) : 0;

  // Avg hours by product type
  function byType(type) {
    var jobs = currentCompleted.filter(function(r) {
      return String(r[C.productType]).trim().toLowerCase().indexOf(type) !== -1;
    });
    return jobs.length > 0
      ? jobs.reduce(function(s, r) { return s + (Number(r[C.totalHours]) || 0); }, 0) / jobs.length
      : 0;
  }

  var avgHrsPerJob = currentCompleted.length > 0
    ? totalHoursCurrent / currentCompleted.length : 0;

  // Client hours
  var clientMap = {};
  currentCompleted.forEach(function(r) {
    var code = String(r[C.clientCode]).trim() || 'Unknown';
    clientMap[code] = (clientMap[code] || 0) + (Number(r[C.totalHours]) || 0);
  });
  var clientHours = ['SBS','TITAN','MATIX-SK','NORSPAN-MB'].map(function(code) {
    return { name: code, hours: Math.round((clientMap[code] || 0) * 10) / 10 };
  });

  // Designer stats
  var designerMap = {};
  currentJobs.forEach(function(r) {
    var name = String(r[C.designer]).trim() || 'Unknown';
    if (!designerMap[name]) designerMap[name] = { completed: 0, hours: 0, inProgress: 0, rework: 0 };
    var status = String(r[C.status]).trim();
    if (status === completedStatus || status === billedStatus) {
      designerMap[name].completed++;
      designerMap[name].hours += Number(r[C.totalHours]) || 0;
      if (String(r[C.reworkFlag]).trim().toLowerCase() === 'yes') designerMap[name].rework++;
    }
  });
  inProgress.forEach(function(r) {
    var name = String(r[C.designer]).trim() || 'Unknown';
    if (!designerMap[name]) designerMap[name] = { completed: 0, hours: 0, inProgress: 0, rework: 0 };
    designerMap[name].inProgress++;
  });
  var designerStats = Object.keys(designerMap).map(function(name) {
    var d = designerMap[name];
    return { name: name, completed: d.completed, hours: Math.round(d.hours * 10) / 10, inProgress: d.inProgress, rework: d.rework };
  });

  // Pipeline
  var statusCounts = {};
  inProgress.forEach(function(r) {
    var s = String(r[C.status]).trim();
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });
  var pipelineOrder = [
    CONFIG.status.allocated,
    CONFIG.status.pickedUp,
    CONFIG.status.inDesign,
    CONFIG.status.submittedForQC,
    CONFIG.status.qcInProgress,
    CONFIG.status.reworkMajor,
    CONFIG.status.reworkMinor,
    CONFIG.status.waitingReQC,
    CONFIG.status.waitingSpotCheck,
    CONFIG.status.spotCheckProgress,
    CONFIG.status.onHold
  ];
  var pipeline = pipelineOrder
    .map(function(s) { return { status: s, count: statusCounts[s] || 0 }; })
    .filter(function(p) { return p.count > 0; });

  // Client rework
  var clientReworkMap = {};
  currentCompleted.forEach(function(r) {
    var code = String(r[C.clientCode]).trim() || 'Unknown';
    if (!clientReworkMap[code]) clientReworkMap[code] = { completed: 0, rework: 0 };
    clientReworkMap[code].completed++;
    if (String(r[C.reworkFlag]).trim().toLowerCase() === 'yes') clientReworkMap[code].rework++;
  });
  var clientRework = ['SBS','TITAN','MATIX-SK','NORSPAN-MB'].map(function(code) {
    return {
      name: code,
      completed: (clientReworkMap[code] || {}).completed || 0,
      rework: (clientReworkMap[code] || {}).rework || 0
    };
  });

  var snapshot = buildSnapshot(liveJobs, C, completedStatus, billedStatus, currentPeriod);
  var alerts = buildAlerts(liveJobs, C, designerMap, clientReworkMap, currentPeriod, completedStatus, billedStatus);

  return {
    currentPeriod: currentPeriod,
    kpis: {
      totalHours:          Math.round(totalHoursCurrent * 10) / 10,
      lastPeriodHours:     Math.round(totalHoursLast * 10) / 10,
      completed:           currentCompleted.length,
      lastPeriodCompleted: lastCompleted.length,
      inProgress:          inProgress.length,
      avgHrsPerJob:        Math.round(avgHrsPerJob * 10) / 10,
      roofAvg:             Math.round(byType('roof') * 10) / 10,
      floorAvg:            Math.round(byType('floor') * 10) / 10,
      wallAvg:             Math.round(byType('wall') * 10) / 10,
      allocated:           statusCounts[CONFIG.status.allocated] || 0,
      readyQC:             statusCounts[CONFIG.status.readyForQC] || 0,
      reworkRate:          Math.round(reworkRate * 10) / 10,
      reworkHours:         Math.round(reworkHoursTotal * 10) / 10,
      majorRework:         majorRework.length,
      minorRework:         minorRework.length
    },
    clientHours:   clientHours,
    designerStats: designerStats,
    pipeline:      pipeline,
    clientRework:  clientRework,
    snapshot:      snapshot,
    alerts:        alerts
  };
}

function buildSnapshot(liveJobs, C, completedStatus, billedStatus, currentPeriod) {
  var allPeriods = [];
  liveJobs.forEach(function(r) {
    var p = String(r[C.billingPeriod]).trim();
    if (p && allPeriods.indexOf(p) === -1) allPeriods.push(p);
  });
  allPeriods.sort(comparePeriods);
  var recentPeriods = allPeriods.slice(-6);

  return recentPeriods.map(function(period) {
    var periodJobs = liveJobs.filter(function(r) {
      return String(r[C.billingPeriod]).trim() === period;
    });
    var completed = periodJobs.filter(function(r) {
      var s = String(r[C.status]).trim();
      return s === completedStatus || s === billedStatus;
    });
    var hours = completed.reduce(function(s, r) {
      return s + (Number(r[C.totalHours]) || 0);
    }, 0);
    var reworkCount = completed.filter(function(r) {
      return String(r[C.reworkFlag]).trim().toLowerCase() === 'yes';
    }).length;
    return {
      period:      period,
      jobsIn:      periodJobs.length,
      completed:   completed.length,
      hours:       Math.round(hours * 10) / 10,
      reworkRate:  completed.length > 0 ? Math.round(reworkCount / completed.length * 1000) / 10 : 0,
      avgHrs:      completed.length > 0 ? Math.round(hours / completed.length * 10) / 10 : 0,
      isCurrent:   period === currentPeriod
    };
  });
}

function buildAlerts(liveJobs, C, designerMap, clientReworkMap, currentPeriod, completedStatus, billedStatus) {
  var alerts = [];
  var today = new Date();

  // Overdue jobs
  var overdue = liveJobs.filter(function(r) {
    var status = String(r[C.status]).trim();
    if (status === completedStatus || status === billedStatus) return false;
    var expected = r[C.allocatedDate];
    if (!expected || expected === '') return false;
    var expDate = new Date(expected);
    return !isNaN(expDate) && expDate < today;
  });
  if (overdue.length > 0) {
    var nums = overdue.slice(0, 5).map(function(r) {
      return String(r[C.jobNumber]).trim();
    }).join(', ');
    alerts.push({
      level: 'red', icon: '🔴',
      title: overdue.length + ' job' + (overdue.length > 1 ? 's' : '') + ' overdue',
      desc: 'Jobs past expected completion: ' + nums + (overdue.length > 5 ? ' and ' + (overdue.length - 5) + ' more' : '') + '.'
    });
  }

  // High rework designers
  Object.keys(designerMap).forEach(function(name) {
    var d = designerMap[name];
    if (d.completed >= 2) {
      var rate = d.rework / d.completed * 100;
      if (rate > 20) {
        alerts.push({
          level: 'amber', icon: '⚠️',
          title: name + ': Rework rate ' + rate.toFixed(0) + '% - above 20% threshold',
          desc: d.rework + ' rework in ' + d.completed + ' completed jobs this period.'
        });
      }
    }
  });

  // High rework clients
  Object.keys(clientReworkMap).forEach(function(code) {
    var d = clientReworkMap[code];
    if (d.completed >= 3) {
      var rate = d.rework / d.completed * 100;
      if (rate > 20) {
        alerts.push({
          level: 'amber', icon: '📋',
          title: code + ': Client rework rate ' + rate.toFixed(0) + '%',
          desc: d.rework + ' of ' + d.completed + ' completed jobs required rework this period.'
        });
      }
    }
  });

  // Designers with no activity
  Object.keys(designerMap).forEach(function(name) {
    var d = designerMap[name];
    if (d.completed === 0 && d.inProgress === 0) {
      alerts.push({
        level: 'amber', icon: '👤',
        title: name + ': No active or completed jobs this period',
        desc: 'No jobs in progress or completed. Check allocation.'
      });
    }
  });

  // QC backlog
  var stuckQC = liveJobs.filter(function(r) {
    return String(r[C.status]).trim() === CONFIG.status.submittedForQC;
  });
  if (stuckQC.length > 3) {
    alerts.push({
      level: 'amber', icon: '🔍',
      title: stuckQC.length + ' jobs waiting for QC review',
      desc: 'QC queue may be a bottleneck. Consider additional QC capacity.'
    });
  }

  if (alerts.length === 0) {
    alerts.push({ level: 'green', icon: '✅', title: 'All clear', desc: 'No alerts this period. Business running smoothly.' });
  }

  return alerts;
}

function getBillingRates(clientSheet) {
  var rates = {};
  if (!clientSheet) return rates;
  var data = clientSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var code = String(data[i][0]).trim();
    var rate = Number(data[i][3]);
    if (code && !isNaN(rate) && rate > 0) rates[code] = rate;
  }
  return rates;
}

function getCurrentAndLastPeriod() {
  var now = new Date();
  var day = now.getDate();
  var year = now.getFullYear();
  var month = String(now.getMonth() + 1).padStart(2, '0');

  // Previous month
  var prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var prevYear = prevDate.getFullYear();
  var prevMonth = String(prevDate.getMonth() + 1).padStart(2, '0');

  var currentPeriod, lastPeriod;
  if (day <= 15) {
    currentPeriod = year + '-' + month + ' | 1-15';
    lastPeriod = prevYear + '-' + prevMonth + ' | 16-End';
  } else {
    currentPeriod = year + '-' + month + ' | 16-End';
    lastPeriod = year + '-' + month + ' | 1-15';
  }
  return { currentPeriod: currentPeriod, lastPeriod: lastPeriod };
}

function comparePeriods(a, b) {
  function parse(s) {
    // Format: "2026-03 | 1-15" or "2026-03 | 16-End"
    var parts = s.match(/(\d{4})-(\d{2})\s*\|\s*(\d+)/);
    if (!parts) return 0;
    var y = parseInt(parts[1]);
    var m = parseInt(parts[2]);
    var d = parseInt(parts[3]);
    return y * 10000 + m * 100 + d;
  }
  return parse(a) - parse(b);
}

function getEmptyDashboardData() {
  var p = getCurrentAndLastPeriod();
  return {
    currentPeriod: p.currentPeriod,
    kpis: { totalHours:0, lastPeriodHours:0, completed:0, lastPeriodCompleted:0, inProgress:0,
            avgHrsPerJob:0, roofAvg:0, floorAvg:0, wallAvg:0, allocated:0, readyQC:0,
            reworkRate:0, reworkHours:0, majorRework:0, minorRework:0 },
    clientHours:  [{name:'SBS',hours:0},{name:'TITAN',hours:0},{name:'MATIX-SK',hours:0},{name:'NORSPAN-MB',hours:0}],
    designerStats: [],
    pipeline:     [],
    clientRework: [{name:'SBS',completed:0,rework:0},{name:'TITAN',completed:0,rework:0},{name:'MATIX-SK',completed:0,rework:0},{name:'NORSPAN-MB',completed:0,rework:0}],
    snapshot:     [],
    alerts:       [{ level:'green', icon:'ℹ️', title:'No data yet', desc:'No completed jobs found for the current billing period.' }]
  };
}
