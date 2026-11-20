"use strict";
(self["rspackChunkcorrexit"] = self["rspackChunkcorrexit"] || []).push([["packages_contracts_lib_index_js-_35c50"], {
"./packages/contracts/lib/index.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  COLLECTOR: () => (COLLECTOR),
  Collector: () => (Collector),
  DISTRIBUTOR: () => (DISTRIBUTOR),
  Distributor: () => (Distributor),
  Identifier: () => (Identifier),
  REGISTRAR: () => (REGISTRAR),
  Registrar: () => (Registrar),
  SUBMITTER: () => (SUBMITTER),
  Submitter: () => (Submitter),
  UNLOCKER: () => (UNLOCKER),
  Unlocker: () => (Unlocker)
});
/* import */ var _lumino_coreutils__rspack_import_0 = __webpack_require__("webpack/sharing/consume/default/@lumino/coreutils");
/* import */ var _lumino_coreutils__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_lumino_coreutils__rspack_import_0);

var Identifier;
(function (Identifier) {
    /** Type guard for assigned identifiers. */
    function assigned(id) {
        return typeof id.assignee === 'string' && typeof id.file === 'string';
    }
    Identifier.assigned = assigned;
})(Identifier || (Identifier = {}));
const COLLECTOR = 'correxit:collector';
const Collector = new _lumino_coreutils__rspack_import_0.Token(COLLECTOR);
const DISTRIBUTOR = 'correxit:distributor';
const Distributor = new _lumino_coreutils__rspack_import_0.Token(DISTRIBUTOR);
const REGISTRAR = 'correxit:registrar';
const Registrar = new _lumino_coreutils__rspack_import_0.Token(REGISTRAR);
const SUBMITTER = 'correxit:submitter';
const Submitter = new _lumino_coreutils__rspack_import_0.Token(SUBMITTER);
const UNLOCKER = 'correxit:unlocker';
const Unlocker = new _lumino_coreutils__rspack_import_0.Token(UNLOCKER);


},

}]);
//# sourceMappingURL=packages_contracts_lib_index_js-_35c50.f14620b6404684d8.js.map