// n8n loads the package via the `n8n` field in package.json, which
// already points at the built dist/ files. This file exists only to
// satisfy npm/Node's expectation of a `main` entrypoint.
module.exports = {};
