function cmdbLabelsClientLog(stage, message) {
    try {
        var image = new Image();
        image.src = '/cmdbuild/custom-api/labels/client-log?stage=' + encodeURIComponent(stage || '') +
            '&message=' + encodeURIComponent(message || '') +
            '&_=' + String(new Date().getTime());
    } catch (error) {
    }
}

function cmdbLabelsTargetUrl() {
    return '/cmdbuild/labels/ui';
}

function cmdbLabelsLauncherState() {
    window.__cmdbLabelsLauncher = window.__cmdbLabelsLauncher || {};
    return window.__cmdbLabelsLauncher;
}

function cmdbLabelsShouldAutoOpen() {
    var hash = window.location.hash || '';
    return hash.indexOf('custompages/CmdbLabels') !== -1;
}

function cmdbLabelsOpenUi(stage) {
    var target = cmdbLabelsTargetUrl();
    var state = cmdbLabelsLauncherState();
    if (state.redirecting) {
        cmdbLabelsClientLog('redirect-skip', stage || 'already-redirecting');
        return;
    }
    state.redirecting = true;
    if (stage) {
        cmdbLabelsClientLog(stage, target);
    }
    cmdbLabelsClientLog('launcher-redirect', target);
    window.location.replace(target);
}

function cmdbLabelsScheduleRedirect(stage) {
    window.setTimeout(function () {
        cmdbLabelsOpenUi(stage);
    }, 0);
}

cmdbLabelsClientLog('script-loaded', 'launcher');

if (cmdbLabelsShouldAutoOpen()) {
    cmdbLabelsScheduleRedirect('hash-redirect');
}

Ext.define('CMDBuildUI.view.custompages.CmdbLabels.CmdbLabels', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.cmdb-labels',
    mixins: ['CMDBuildUI.mixins.CustomPage'],

    bodyPadding: 16,
    scrollable: true,
    title: 'CMDB Labels',

    initComponent: function () {
        cmdbLabelsClientLog('initComponent', 'launcher');
        cmdbLabelsScheduleRedirect('initComponent-redirect');
        this.html = [
            '<div style="font-family:Arial,sans-serif;line-height:1.45">',
            '<h2 style="font-size:20px;margin:0 0 8px">CMDB Labels</h2>',
            '<p style="margin:0 0 12px;color:#52606d">Opening label generator...</p>',
            '<p style="margin:0"><a style="display:inline-block;background:#2563eb;color:#fff;padding:8px 12px;border-radius:4px;text-decoration:none;font-weight:600" href="/cmdbuild/labels/ui">Open label generator</a></p>',
            '</div>'
        ].join('');
        this.callParent(arguments);
        this.on('afterrender', function () {
            cmdbLabelsClientLog('afterrender', 'launcher');
            cmdbLabelsScheduleRedirect('afterrender-redirect');
        }, this, { single: true });
    }
});
