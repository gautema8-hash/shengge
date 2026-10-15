/**
 * admin/backend 复用与 app/backend 完全相同的数据层（同一份 db.json）。
 * 这里直接转发 require，保证单一事实来源。
 */
module.exports = require('../../app/backend/store');
