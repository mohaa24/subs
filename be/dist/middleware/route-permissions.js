"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enforceRoutePermissions = enforceRoutePermissions;
exports.readWritePermissions = readWritePermissions;
const permissions_js_1 = require("../routes/permissions.js");
function enforceRoutePermissions(resolve) {
    return (req, res, next) => {
        const permission = resolve(req);
        if (!permission)
            return next();
        return (0, permissions_js_1.requirePermission)(permission)(req, res, next);
    };
}
function readWritePermissions(read, create, edit = create) {
    return (req) => {
        if (req.method === "GET" || req.method === "HEAD")
            return read;
        if (req.method === "POST")
            return create;
        return edit;
    };
}
