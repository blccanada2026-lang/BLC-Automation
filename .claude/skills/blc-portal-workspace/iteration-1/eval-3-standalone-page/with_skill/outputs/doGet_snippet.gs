// doGet routing addition for QuarterlyBonus page
// Add 'quarterly-bonus' branch alongside 'rate-staff' in Portal.gs

function doGet(e) {
  var page    = e && e.parameter && e.parameter.page    ? e.parameter.page    : '';
  var period  = e && e.parameter && e.parameter.period  ? e.parameter.period  : '';
  var quarter = e && e.parameter && e.parameter.quarter ? e.parameter.quarter : '';
  var year    = e && e.parameter && e.parameter.year    ? e.parameter.year    : '';

  if (page === 'rate-staff') {
    var preview = e && e.parameter && e.parameter.preview ? e.parameter.preview : '';
    var html    = HtmlService.createHtmlOutputFromFile('07-portal/QuarterlyRating');
    var content = '<script>var INJECTED_PERIOD = '       + JSON.stringify(period)  + ';<\/script>\n'
                + '<script>var INJECTED_PREVIEW_CODE = ' + JSON.stringify(preview) + ';<\/script>\n'
                + html.getContent();
    return HtmlService.createHtmlOutput(content)
      .setTitle('BLC Quarterly Ratings')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (page === 'quarterly-bonus') {
    var bonusHtml    = HtmlService.createHtmlOutputFromFile('07-portal/QuarterlyBonus');
    var bonusContent = '<script>var INJECTED_QUARTER = ' + JSON.stringify(quarter) + ';<\/script>\n'
                     + '<script>var INJECTED_YEAR    = ' + JSON.stringify(year)    + ';<\/script>\n'
                     + bonusHtml.getContent();
    return HtmlService.createHtmlOutput(bonusContent)
      .setTitle('BLC Quarterly Bonus Preview')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService
    .createHtmlOutputFromFile('07-portal/PortalView')
    .setTitle('BLC Job Portal')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
