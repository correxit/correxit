"use strict";
(self["rspackChunkcorrexit"] = self["rspackChunkcorrexit"] || []).push([["style_index_js"], {
"./node_modules/css-loader/dist/runtime/api.js"(module) {


/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
module.exports = function (cssWithMappingToString) {
  var list = [];

  // return the list of modules as css string
  list.toString = function toString() {
    return this.map(function (item) {
      var content = "";
      var needLayer = typeof item[5] !== "undefined";
      if (item[4]) {
        content += "@supports (".concat(item[4], ") {");
      }
      if (item[2]) {
        content += "@media ".concat(item[2], " {");
      }
      if (needLayer) {
        content += "@layer".concat(item[5].length > 0 ? " ".concat(item[5]) : "", " {");
      }
      content += cssWithMappingToString(item);
      if (needLayer) {
        content += "}";
      }
      if (item[2]) {
        content += "}";
      }
      if (item[4]) {
        content += "}";
      }
      return content;
    }).join("");
  };

  // import a list of modules into the list
  list.i = function i(modules, media, dedupe, supports, layer) {
    if (typeof modules === "string") {
      modules = [[null, modules, undefined]];
    }
    var alreadyImportedModules = {};
    if (dedupe) {
      for (var k = 0; k < this.length; k++) {
        var id = this[k][0];
        if (id != null) {
          alreadyImportedModules[id] = true;
        }
      }
    }
    for (var _k = 0; _k < modules.length; _k++) {
      var item = [].concat(modules[_k]);
      if (dedupe && alreadyImportedModules[item[0]]) {
        continue;
      }
      if (typeof layer !== "undefined") {
        if (typeof item[5] === "undefined") {
          item[5] = layer;
        } else {
          item[1] = "@layer".concat(item[5].length > 0 ? " ".concat(item[5]) : "", " {").concat(item[1], "}");
          item[5] = layer;
        }
      }
      if (media) {
        if (!item[2]) {
          item[2] = media;
        } else {
          item[1] = "@media ".concat(item[2], " {").concat(item[1], "}");
          item[2] = media;
        }
      }
      if (supports) {
        if (!item[4]) {
          item[4] = "".concat(supports);
        } else {
          item[1] = "@supports (".concat(item[4], ") {").concat(item[1], "}");
          item[4] = supports;
        }
      }
      list.push(item);
    }
  };
  return list;
};

},
"./node_modules/css-loader/dist/runtime/getUrl.js"(module) {


module.exports = function (url, options) {
  if (!options) {
    options = {};
  }
  if (!url) {
    return url;
  }
  url = String(url.__esModule ? url.default : url);

  // If url is already wrapped in quotes, remove them
  if (/^['"].*['"]$/.test(url)) {
    url = url.slice(1, -1);
  }
  if (options.hash) {
    url += options.hash;
  }

  // Should url be wrapped?
  // See https://drafts.csswg.org/css-values-3/#urls
  if (/["'() \t\n]|(%20)/.test(url) || options.needQuotes) {
    return "\"".concat(url.replace(/"/g, '\\"').replace(/\n/g, "\\n"), "\"");
  }
  return url;
};

},
"./node_modules/css-loader/dist/runtime/sourceMaps.js"(module) {


module.exports = function (item) {
  var content = item[1];
  var cssMapping = item[3];
  if (!cssMapping) {
    return content;
  }
  if (typeof btoa === "function") {
    var base64 = btoa(unescape(encodeURIComponent(JSON.stringify(cssMapping))));
    var data = "sourceMappingURL=data:application/json;charset=utf-8;base64,".concat(base64);
    var sourceMapping = "/*# ".concat(data, " */");
    return [content].concat([sourceMapping]).join("\n");
  }
  return [content].join("\n");
};

},
"./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js"(module) {


var stylesInDOM = [];
function getIndexByIdentifier(identifier) {
  var result = -1;
  for (var i = 0; i < stylesInDOM.length; i++) {
    if (stylesInDOM[i].identifier === identifier) {
      result = i;
      break;
    }
  }
  return result;
}
function modulesToDom(list, options) {
  var idCountMap = {};
  var identifiers = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var id = options.base ? item[0] + options.base : item[0];
    var count = idCountMap[id] || 0;
    var identifier = "".concat(id, " ").concat(count);
    idCountMap[id] = count + 1;
    var indexByIdentifier = getIndexByIdentifier(identifier);
    var obj = {
      css: item[1],
      media: item[2],
      sourceMap: item[3],
      supports: item[4],
      layer: item[5]
    };
    if (indexByIdentifier !== -1) {
      stylesInDOM[indexByIdentifier].references++;
      stylesInDOM[indexByIdentifier].updater(obj);
    } else {
      var updater = addElementStyle(obj, options);
      options.byIndex = i;
      stylesInDOM.splice(i, 0, {
        identifier: identifier,
        updater: updater,
        references: 1
      });
    }
    identifiers.push(identifier);
  }
  return identifiers;
}
function addElementStyle(obj, options) {
  var api = options.domAPI(options);
  api.update(obj);
  var updater = function updater(newObj) {
    if (newObj) {
      if (newObj.css === obj.css && newObj.media === obj.media && newObj.sourceMap === obj.sourceMap && newObj.supports === obj.supports && newObj.layer === obj.layer) {
        return;
      }
      api.update(obj = newObj);
    } else {
      api.remove();
    }
  };
  return updater;
}
module.exports = function (list, options) {
  options = options || {};
  list = list || [];
  var lastIdentifiers = modulesToDom(list, options);
  return function update(newList) {
    newList = newList || [];
    for (var i = 0; i < lastIdentifiers.length; i++) {
      var identifier = lastIdentifiers[i];
      var index = getIndexByIdentifier(identifier);
      stylesInDOM[index].references--;
    }
    var newLastIdentifiers = modulesToDom(newList, options);
    for (var _i = 0; _i < lastIdentifiers.length; _i++) {
      var _identifier = lastIdentifiers[_i];
      var _index = getIndexByIdentifier(_identifier);
      if (stylesInDOM[_index].references === 0) {
        stylesInDOM[_index].updater();
        stylesInDOM.splice(_index, 1);
      }
    }
    lastIdentifiers = newLastIdentifiers;
  };
};

},
"./node_modules/style-loader/dist/runtime/insertBySelector.js"(module) {


var memo = {};

/* istanbul ignore next  */
function getTarget(target) {
  if (typeof memo[target] === "undefined") {
    var styleTarget = document.querySelector(target);

    // Special case to return head of iframe instead of iframe itself
    if (window.HTMLIFrameElement && styleTarget instanceof window.HTMLIFrameElement) {
      try {
        // This will throw an exception if access to iframe is blocked
        // due to cross-origin restrictions
        styleTarget = styleTarget.contentDocument.head;
      } catch (e) {
        // istanbul ignore next
        styleTarget = null;
      }
    }
    memo[target] = styleTarget;
  }
  return memo[target];
}

/* istanbul ignore next  */
function insertBySelector(insert, style) {
  var target = getTarget(insert);
  if (!target) {
    throw new Error("Couldn't find a style target. This probably means that the value for the 'insert' parameter is invalid.");
  }
  target.appendChild(style);
}
module.exports = insertBySelector;

},
"./node_modules/style-loader/dist/runtime/insertStyleElement.js"(module) {


/* istanbul ignore next  */
function insertStyleElement(options) {
  var element = document.createElement("style");
  options.setAttributes(element, options.attributes);
  options.insert(element, options.options);
  return element;
}
module.exports = insertStyleElement;

},
"./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js"(module, __unused_rspack_exports, __webpack_require__) {


/* istanbul ignore next  */
function setAttributesWithoutAttributes(styleElement) {
  var nonce =  true ? __webpack_require__.nc : 0;
  if (nonce) {
    styleElement.setAttribute("nonce", nonce);
  }
}
module.exports = setAttributesWithoutAttributes;

},
"./node_modules/style-loader/dist/runtime/styleDomAPI.js"(module) {


/* istanbul ignore next  */
function apply(styleElement, options, obj) {
  var css = "";
  if (obj.supports) {
    css += "@supports (".concat(obj.supports, ") {");
  }
  if (obj.media) {
    css += "@media ".concat(obj.media, " {");
  }
  var needLayer = typeof obj.layer !== "undefined";
  if (needLayer) {
    css += "@layer".concat(obj.layer.length > 0 ? " ".concat(obj.layer) : "", " {");
  }
  css += obj.css;
  if (needLayer) {
    css += "}";
  }
  if (obj.media) {
    css += "}";
  }
  if (obj.supports) {
    css += "}";
  }
  var sourceMap = obj.sourceMap;
  if (sourceMap && typeof btoa !== "undefined") {
    css += "\n/*# sourceMappingURL=data:application/json;base64,".concat(btoa(unescape(encodeURIComponent(JSON.stringify(sourceMap)))), " */");
  }

  // For old IE
  /* istanbul ignore if  */
  options.styleTagTransform(css, styleElement, options.options);
}
function removeStyleElement(styleElement) {
  // istanbul ignore if
  if (styleElement.parentNode === null) {
    return false;
  }
  styleElement.parentNode.removeChild(styleElement);
}

/* istanbul ignore next  */
function domAPI(options) {
  if (typeof document === "undefined") {
    return {
      update: function update() {},
      remove: function remove() {}
    };
  }
  var styleElement = options.insertStyleElement(options);
  return {
    update: function update(obj) {
      apply(styleElement, options, obj);
    },
    remove: function remove() {
      removeStyleElement(styleElement);
    }
  };
}
module.exports = domAPI;

},
"./node_modules/style-loader/dist/runtime/styleTagTransform.js"(module) {


/* istanbul ignore next  */
function styleTagTransform(css, styleElement) {
  if (styleElement.styleSheet) {
    styleElement.styleSheet.cssText = css;
  } else {
    while (styleElement.firstChild) {
      styleElement.removeChild(styleElement.firstChild);
    }
    styleElement.appendChild(document.createTextNode(css));
  }
}
module.exports = styleTagTransform;

},
"./style/index.js"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
/* import */ var _index_css__rspack_import_0 = __webpack_require__("./style/index.css");



},
"./node_modules/css-loader/dist/cjs.js!./style/corrector/index.css"(module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  "default": () => (__rspack_default_export)
});
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0 = __webpack_require__("./node_modules/css-loader/dist/runtime/sourceMaps.js");
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0);
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1 = __webpack_require__("./node_modules/css-loader/dist/runtime/api.js");
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__rspack_import_1);
// Imports


var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default()((_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default()));
// Module
___CSS_LOADER_EXPORT___.push([module.id, `/* Widget container */

.correxit-corrector-widget {
  background-color: var(--jp-rendermime-table-row-background);

  &.cxt-mod-cd .jp-Dialog .jp-Dialog-content {
    max-height: 80%;
    max-width: 80%;
    min-height: 80%;
    min-width: 80%;
  }
}

.correxit-corrector-widget-content {
  height: 100%;
  overflow-y: auto;
  width: 100%;
}

/* Cell styles */

td {
  .correxit-corrector-icon {
    align-items: center;
    display: flex;
    height: 100%;
    justify-content: center;
  }

  &.correxit-corrector-assignee {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &.correxit-corrector-breakdown {
    overflow: hidden;
  }

  &.correxit-corrector-status {
    text-align: right;
  }
}

/* Score breakdown bar */

.correxit-corrector-breakdown-bar {
  display: flex;
  gap: 1px;
  height: 8px;
  width: 100%;
}

.correxit-corrector-breakdown-segment {
  appearance: none;
  border: none;
  cursor: pointer;
  flex: 1;
  min-width: 2px;
  padding: 0;

  &.correxit-corrector-breakdown-correct {
    background-color: var(--correxit-correct-color);
    background-image: none;
  }

  &.correxit-corrector-breakdown-incorrect {
    background-color: var(--correxit-incorrect-color);
    background-image: repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 2px,
      rgb(0 0 0 / 15%) 2px,
      rgb(0 0 0 / 15%) 4px
    );
  }

  &.correxit-corrector-breakdown-partial {
    background-color: var(--correxit-partial-color);
    background-image: none;
  }

  &.correxit-corrector-breakdown-review {
    background-color: var(--correxit-insistent-color);
    background-image: repeating-linear-gradient(
      45deg,
      transparent,
      transparent 2px,
      rgb(255 255 255 / 30%) 2px,
      rgb(255 255 255 / 30%) 4px
    );
  }

  &.correxit-corrector-breakdown-unscored {
    background-color: var(--correxit-unscored-color);
    background-image: none;
  }

  &:focus-visible {
    box-shadow:
      0 0 0 1px var(--jp-layout-color1),
      0 0 0 3px var(--jp-brand-color1);
    outline: none;
    position: relative;
    z-index: 1;
  }
}

/* Status chip */

.correxit-corrector-chip {
  border-left: 3px solid transparent;
  border-radius: 2px;
  box-sizing: border-box;
  display: inline-block;
  font-size: var(--jp-ui-font-size0);
  line-height: 1.4;
  padding: 1px 6px;
  white-space: nowrap;
  width: calc(var(--correxit-corrector-status-width) - 12px);

  &.cxt-mod-certified {
    background-color: color-mix(
      in srgb,
      var(--correxit-correct-color) 12%,
      transparent
    );
    border-left-color: var(--correxit-correct-color);
  }

  &.cxt-mod-collected {
    background-color: color-mix(
      in srgb,
      var(--correxit-correct-color) 20%,
      transparent
    );
    border-left-color: var(--correxit-correct-color);
    color: var(--correxit-correct-color);
  }

  &.cxt-mod-failed {
    background-color: color-mix(
      in srgb,
      var(--jp-error-color1) 12%,
      transparent
    );
    border-left-color: var(--jp-error-color1);
    color: var(--jp-error-color1);
  }

  &.cxt-mod-pending {
    align-items: center;
    display: inline-flex;
    gap: 2px;
  }

  &.cxt-mod-review {
    background-color: color-mix(
      in srgb,
      var(--correxit-insistent-color) 12%,
      transparent
    );
    border-left-color: var(--correxit-insistent-color);
  }
}

/* Pending animation dots */

.correxit-corrector-pending-dot {
  animation: correxit-corrector-pending-dot-bounce 1.4s infinite ease-in-out;
  background-color: var(--jp-brand-color1);
  border-radius: 50%;
  height: 4px;
  width: 4px;

  &:nth-child(1) {
    animation-delay: -0.32s;
  }

  &:nth-child(2) {
    animation-delay: -0.16s;
  }

  &:nth-child(3) {
    animation-delay: 0s;
  }
}

/* Corrector table */

table.correxit-corrector {
  --correxit-corrector-assignee-width: 150px;
  --correxit-corrector-icon-size: 16px;
  --correxit-corrector-icon-width: 32px;
  --correxit-corrector-status-width: 140px;

  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;

  col.correxit-corrector-col-kernel,
  col.correxit-corrector-col-open {
    width: var(--correxit-corrector-icon-width);
  }

  col.correxit-corrector-col-assignee {
    width: var(--correxit-corrector-assignee-width);
  }

  col.correxit-corrector-col-status {
    width: var(--correxit-corrector-status-width);
  }

  img,
  svg {
    height: var(--correxit-corrector-icon-size);
    width: var(--correxit-corrector-icon-size);
  }

  tr {
    background-color: var(--jp-rendermime-table-row-background);

    &:hover {
      background-color: var(--jp-rendermime-table-row-hover-background);
    }

    td {
      border-color: var(--jp-border-color0);
      border-style: solid;
      border-width: var(--jp-border-width);
      height: 32px;
      padding: 5px;
    }

    &:focus-visible td {
      box-shadow: inset 0 0 0 2px var(--jp-brand-color1);
    }

    &:focus-within td {
      box-shadow: inset 0 0 0 2px var(--jp-brand-color1);
    }

    &.cxt-mod-failed td {
      opacity: 0.6;
    }

    &.cxt-mod-pending {
      td {
        border-color: var(--jp-border-color0) transparent
          var(--jp-border-color0) transparent;
      }

      .correxit-corrector-breakdown-segment {
        animation: correxit-corrector-pending-pulse 1.4s infinite ease-in-out;
        opacity: 0.6;
      }
    }

    &.correxit-corrector-progress {
      background-color: var(--jp-layout-color2);

      td {
        background-color: var(--jp-layout-color2);
        height: 16px;
        padding: 0;

        & > .correxit-corrector-progress-bar {
          align-items: center;
          display: flex;
          font-size: var(--jp-ui-font-size0);
          gap: 6px;
          height: 100%;
          width: 100%;

          & > progress {
            display: block;
            flex: 1;
            height: 100%;
          }
        }
      }
    }

    &.cxt-mod-selected {
      td {
        background-color: var(--jp-brand-color1);
        color: var(--jp-ui-inverse-font-color1);

        .jp-icon-selectable[fill] {
          fill: var(--jp-ui-inverse-font-color0);
        }
      }

      .correxit-corrector-chip {
        border-left-color: currentcolor;

        &.cxt-mod-collected {
          background-color: var(--jp-ui-inverse-font-color1);
          color: var(--jp-brand-color1);
        }
      }

      &:focus-within td {
        box-shadow: inset 0 0 0 2px var(--jp-layout-color1);
      }
    }

    &.correxit-corrector-progress.cxt-mod-active td {
      position: sticky;
      top: 0;
      z-index: 1;
    }
  }
}

/* Mode controls */

.correxit-corrector-mode {
  align-items: center;
  display: flex;
  gap: 8px;
}

.correxit-corrector-mode-options {
  display: flex;
  gap: 6px;
}

.correxit-corrector-mode-options label,
.correxit-corrector-overwrite,
.correxit-corrector-submitted {
  align-items: center;
  color: var(--jp-ui-font-color1);
  display: flex;
  font-family: var(--jp-ui-font-family);
  font-size: var(--jp-ui-font-size1);
  gap: 4px;
}

.correxit-corrector-overwrite,
.correxit-corrector-submitted {
  margin-right: 4px;
}

.correxit-corrector-mode-options input,
.correxit-corrector-overwrite input,
.correxit-corrector-submitted input {
  margin: 0;
  vertical-align: middle;
}

.correxit-corrector-mode.cxt-mod-scan .correxit-corrector-overwrite {
  opacity: 0.4;
  pointer-events: none;
}

.correxit-corrector-mode.cxt-mod-collect .correxit-corrector-submitted {
  opacity: 0.4;
  pointer-events: none;
}

.correxit-corrector-mode-go {
  background-color: var(--jp-brand-color1);
  border: none;
  border-radius: var(--jp-border-radius);
  color: var(--jp-ui-inverse-font-color1);
  cursor: pointer;
  font-family: var(--jp-ui-font-family);
  font-size: var(--jp-ui-font-size1);
  padding: 2px 10px;

  &:hover {
    background-color: var(--jp-brand-color0);
  }

  &:focus-visible {
    outline: 1px solid var(--jp-brand-color1);
    outline-offset: 2px;
  }
}

/* Keyframes */

@keyframes correxit-corrector-pending-pulse {
  0%,
  100% {
    opacity: 0.8;
  }

  50% {
    opacity: 0.3;
  }
}

@keyframes correxit-corrector-pending-dot-bounce {
  0%,
  80%,
  100% {
    opacity: 0.5;
    transform: scale(0.8);
  }

  40% {
    opacity: 1;
    transform: scale(1.2);
  }
}
`, "",{"version":3,"sources":["webpack://./style/corrector/index.css"],"names":[],"mappings":"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","sourcesContent":["/* Widget container */\n\n.correxit-corrector-widget {\n  background-color: var(--jp-rendermime-table-row-background);\n\n  &.cxt-mod-cd .jp-Dialog .jp-Dialog-content {\n    max-height: 80%;\n    max-width: 80%;\n    min-height: 80%;\n    min-width: 80%;\n  }\n}\n\n.correxit-corrector-widget-content {\n  height: 100%;\n  overflow-y: auto;\n  width: 100%;\n}\n\n/* Cell styles */\n\ntd {\n  .correxit-corrector-icon {\n    align-items: center;\n    display: flex;\n    height: 100%;\n    justify-content: center;\n  }\n\n  &.correxit-corrector-assignee {\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n\n  &.correxit-corrector-breakdown {\n    overflow: hidden;\n  }\n\n  &.correxit-corrector-status {\n    text-align: right;\n  }\n}\n\n/* Score breakdown bar */\n\n.correxit-corrector-breakdown-bar {\n  display: flex;\n  gap: 1px;\n  height: 8px;\n  width: 100%;\n}\n\n.correxit-corrector-breakdown-segment {\n  appearance: none;\n  border: none;\n  cursor: pointer;\n  flex: 1;\n  min-width: 2px;\n  padding: 0;\n\n  &.correxit-corrector-breakdown-correct {\n    background-color: var(--correxit-correct-color);\n    background-image: none;\n  }\n\n  &.correxit-corrector-breakdown-incorrect {\n    background-color: var(--correxit-incorrect-color);\n    background-image: repeating-linear-gradient(\n      -45deg,\n      transparent,\n      transparent 2px,\n      rgb(0 0 0 / 15%) 2px,\n      rgb(0 0 0 / 15%) 4px\n    );\n  }\n\n  &.correxit-corrector-breakdown-partial {\n    background-color: var(--correxit-partial-color);\n    background-image: none;\n  }\n\n  &.correxit-corrector-breakdown-review {\n    background-color: var(--correxit-insistent-color);\n    background-image: repeating-linear-gradient(\n      45deg,\n      transparent,\n      transparent 2px,\n      rgb(255 255 255 / 30%) 2px,\n      rgb(255 255 255 / 30%) 4px\n    );\n  }\n\n  &.correxit-corrector-breakdown-unscored {\n    background-color: var(--correxit-unscored-color);\n    background-image: none;\n  }\n\n  &:focus-visible {\n    box-shadow:\n      0 0 0 1px var(--jp-layout-color1),\n      0 0 0 3px var(--jp-brand-color1);\n    outline: none;\n    position: relative;\n    z-index: 1;\n  }\n}\n\n/* Status chip */\n\n.correxit-corrector-chip {\n  border-left: 3px solid transparent;\n  border-radius: 2px;\n  box-sizing: border-box;\n  display: inline-block;\n  font-size: var(--jp-ui-font-size0);\n  line-height: 1.4;\n  padding: 1px 6px;\n  white-space: nowrap;\n  width: calc(var(--correxit-corrector-status-width) - 12px);\n\n  &.cxt-mod-certified {\n    background-color: color-mix(\n      in srgb,\n      var(--correxit-correct-color) 12%,\n      transparent\n    );\n    border-left-color: var(--correxit-correct-color);\n  }\n\n  &.cxt-mod-collected {\n    background-color: color-mix(\n      in srgb,\n      var(--correxit-correct-color) 20%,\n      transparent\n    );\n    border-left-color: var(--correxit-correct-color);\n    color: var(--correxit-correct-color);\n  }\n\n  &.cxt-mod-failed {\n    background-color: color-mix(\n      in srgb,\n      var(--jp-error-color1) 12%,\n      transparent\n    );\n    border-left-color: var(--jp-error-color1);\n    color: var(--jp-error-color1);\n  }\n\n  &.cxt-mod-pending {\n    align-items: center;\n    display: inline-flex;\n    gap: 2px;\n  }\n\n  &.cxt-mod-review {\n    background-color: color-mix(\n      in srgb,\n      var(--correxit-insistent-color) 12%,\n      transparent\n    );\n    border-left-color: var(--correxit-insistent-color);\n  }\n}\n\n/* Pending animation dots */\n\n.correxit-corrector-pending-dot {\n  animation: correxit-corrector-pending-dot-bounce 1.4s infinite ease-in-out;\n  background-color: var(--jp-brand-color1);\n  border-radius: 50%;\n  height: 4px;\n  width: 4px;\n\n  &:nth-child(1) {\n    animation-delay: -0.32s;\n  }\n\n  &:nth-child(2) {\n    animation-delay: -0.16s;\n  }\n\n  &:nth-child(3) {\n    animation-delay: 0s;\n  }\n}\n\n/* Corrector table */\n\ntable.correxit-corrector {\n  --correxit-corrector-assignee-width: 150px;\n  --correxit-corrector-icon-size: 16px;\n  --correxit-corrector-icon-width: 32px;\n  --correxit-corrector-status-width: 140px;\n\n  border-collapse: collapse;\n  table-layout: fixed;\n  width: 100%;\n\n  col.correxit-corrector-col-kernel,\n  col.correxit-corrector-col-open {\n    width: var(--correxit-corrector-icon-width);\n  }\n\n  col.correxit-corrector-col-assignee {\n    width: var(--correxit-corrector-assignee-width);\n  }\n\n  col.correxit-corrector-col-status {\n    width: var(--correxit-corrector-status-width);\n  }\n\n  img,\n  svg {\n    height: var(--correxit-corrector-icon-size);\n    width: var(--correxit-corrector-icon-size);\n  }\n\n  tr {\n    background-color: var(--jp-rendermime-table-row-background);\n\n    &:hover {\n      background-color: var(--jp-rendermime-table-row-hover-background);\n    }\n\n    td {\n      border-color: var(--jp-border-color0);\n      border-style: solid;\n      border-width: var(--jp-border-width);\n      height: 32px;\n      padding: 5px;\n    }\n\n    &:focus-visible td {\n      box-shadow: inset 0 0 0 2px var(--jp-brand-color1);\n    }\n\n    &:focus-within td {\n      box-shadow: inset 0 0 0 2px var(--jp-brand-color1);\n    }\n\n    &.cxt-mod-failed td {\n      opacity: 0.6;\n    }\n\n    &.cxt-mod-pending {\n      td {\n        border-color: var(--jp-border-color0) transparent\n          var(--jp-border-color0) transparent;\n      }\n\n      .correxit-corrector-breakdown-segment {\n        animation: correxit-corrector-pending-pulse 1.4s infinite ease-in-out;\n        opacity: 0.6;\n      }\n    }\n\n    &.correxit-corrector-progress {\n      background-color: var(--jp-layout-color2);\n\n      td {\n        background-color: var(--jp-layout-color2);\n        height: 16px;\n        padding: 0;\n\n        & > .correxit-corrector-progress-bar {\n          align-items: center;\n          display: flex;\n          font-size: var(--jp-ui-font-size0);\n          gap: 6px;\n          height: 100%;\n          width: 100%;\n\n          & > progress {\n            display: block;\n            flex: 1;\n            height: 100%;\n          }\n        }\n      }\n    }\n\n    &.cxt-mod-selected {\n      td {\n        background-color: var(--jp-brand-color1);\n        color: var(--jp-ui-inverse-font-color1);\n\n        .jp-icon-selectable[fill] {\n          fill: var(--jp-ui-inverse-font-color0);\n        }\n      }\n\n      .correxit-corrector-chip {\n        border-left-color: currentcolor;\n\n        &.cxt-mod-collected {\n          background-color: var(--jp-ui-inverse-font-color1);\n          color: var(--jp-brand-color1);\n        }\n      }\n\n      &:focus-within td {\n        box-shadow: inset 0 0 0 2px var(--jp-layout-color1);\n      }\n    }\n\n    &.correxit-corrector-progress.cxt-mod-active td {\n      position: sticky;\n      top: 0;\n      z-index: 1;\n    }\n  }\n}\n\n/* Mode controls */\n\n.correxit-corrector-mode {\n  align-items: center;\n  display: flex;\n  gap: 8px;\n}\n\n.correxit-corrector-mode-options {\n  display: flex;\n  gap: 6px;\n}\n\n.correxit-corrector-mode-options label,\n.correxit-corrector-overwrite,\n.correxit-corrector-submitted {\n  align-items: center;\n  color: var(--jp-ui-font-color1);\n  display: flex;\n  font-family: var(--jp-ui-font-family);\n  font-size: var(--jp-ui-font-size1);\n  gap: 4px;\n}\n\n.correxit-corrector-overwrite,\n.correxit-corrector-submitted {\n  margin-right: 4px;\n}\n\n.correxit-corrector-mode-options input,\n.correxit-corrector-overwrite input,\n.correxit-corrector-submitted input {\n  margin: 0;\n  vertical-align: middle;\n}\n\n.correxit-corrector-mode.cxt-mod-scan .correxit-corrector-overwrite {\n  opacity: 0.4;\n  pointer-events: none;\n}\n\n.correxit-corrector-mode.cxt-mod-collect .correxit-corrector-submitted {\n  opacity: 0.4;\n  pointer-events: none;\n}\n\n.correxit-corrector-mode-go {\n  background-color: var(--jp-brand-color1);\n  border: none;\n  border-radius: var(--jp-border-radius);\n  color: var(--jp-ui-inverse-font-color1);\n  cursor: pointer;\n  font-family: var(--jp-ui-font-family);\n  font-size: var(--jp-ui-font-size1);\n  padding: 2px 10px;\n\n  &:hover {\n    background-color: var(--jp-brand-color0);\n  }\n\n  &:focus-visible {\n    outline: 1px solid var(--jp-brand-color1);\n    outline-offset: 2px;\n  }\n}\n\n/* Keyframes */\n\n@keyframes correxit-corrector-pending-pulse {\n  0%,\n  100% {\n    opacity: 0.8;\n  }\n\n  50% {\n    opacity: 0.3;\n  }\n}\n\n@keyframes correxit-corrector-pending-dot-bounce {\n  0%,\n  80%,\n  100% {\n    opacity: 0.5;\n    transform: scale(0.8);\n  }\n\n  40% {\n    opacity: 1;\n    transform: scale(1.2);\n  }\n}\n"],"sourceRoot":""}]);
// Exports
/* export default */ const __rspack_default_export = (___CSS_LOADER_EXPORT___);


},
"./node_modules/css-loader/dist/cjs.js!./style/index.css"(module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  "default": () => (__rspack_default_export)
});
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0 = __webpack_require__("./node_modules/css-loader/dist/runtime/sourceMaps.js");
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0);
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1 = __webpack_require__("./node_modules/css-loader/dist/runtime/api.js");
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__rspack_import_1);
/* import */ var _node_modules_css_loader_dist_cjs_js_corrector_index_css__rspack_import_2 = __webpack_require__("./node_modules/css-loader/dist/cjs.js!./style/corrector/index.css");
/* import */ var _node_modules_css_loader_dist_cjs_js_monitor_index_css__rspack_import_3 = __webpack_require__("./node_modules/css-loader/dist/cjs.js!./style/monitor/index.css");
/* import */ var _node_modules_css_loader_dist_cjs_js_reviewer_index_css__rspack_import_4 = __webpack_require__("./node_modules/css-loader/dist/cjs.js!./style/reviewer/index.css");
/* import */ var _node_modules_css_loader_dist_cjs_js_ui_annotate_css__rspack_import_5 = __webpack_require__("./node_modules/css-loader/dist/cjs.js!./style/ui/annotate.css");
/* import */ var _node_modules_css_loader_dist_cjs_js_ui_boundary_css__rspack_import_6 = __webpack_require__("./node_modules/css-loader/dist/cjs.js!./style/ui/boundary.css");
/* import */ var _node_modules_css_loader_dist_cjs_js_ui_propagator_css__rspack_import_7 = __webpack_require__("./node_modules/css-loader/dist/cjs.js!./style/ui/propagator.css");
/* import */ var _node_modules_css_loader_dist_cjs_js_ui_sidebar_css__rspack_import_8 = __webpack_require__("./node_modules/css-loader/dist/cjs.js!./style/ui/sidebar.css");
/* import */ var _node_modules_css_loader_dist_cjs_js_ui_toolbars_css__rspack_import_9 = __webpack_require__("./node_modules/css-loader/dist/cjs.js!./style/ui/toolbars.css");
// Imports










var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default()((_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default()));
___CSS_LOADER_EXPORT___.i(_node_modules_css_loader_dist_cjs_js_corrector_index_css__rspack_import_2["default"]);
___CSS_LOADER_EXPORT___.i(_node_modules_css_loader_dist_cjs_js_monitor_index_css__rspack_import_3["default"]);
___CSS_LOADER_EXPORT___.i(_node_modules_css_loader_dist_cjs_js_reviewer_index_css__rspack_import_4["default"]);
___CSS_LOADER_EXPORT___.i(_node_modules_css_loader_dist_cjs_js_ui_annotate_css__rspack_import_5["default"]);
___CSS_LOADER_EXPORT___.i(_node_modules_css_loader_dist_cjs_js_ui_boundary_css__rspack_import_6["default"]);
___CSS_LOADER_EXPORT___.i(_node_modules_css_loader_dist_cjs_js_ui_propagator_css__rspack_import_7["default"]);
___CSS_LOADER_EXPORT___.i(_node_modules_css_loader_dist_cjs_js_ui_sidebar_css__rspack_import_8["default"]);
___CSS_LOADER_EXPORT___.i(_node_modules_css_loader_dist_cjs_js_ui_toolbars_css__rspack_import_9["default"]);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `:root {
  --correxit-correct-color: var(--jp-success-color1);
  --correxit-incorrect-color: var(--jp-error-color1);
  --correxit-insistent-color: var(--md-blue-400);
  --correxit-partial-color: var(--jp-warn-color0);
  --correxit-unscored-color: var(--jp-border-color1);
}
`, "",{"version":3,"sources":["webpack://./style/index.css"],"names":[],"mappings":"AASA;EACE,kDAAkD;EAClD,kDAAkD;EAClD,8CAA8C;EAC9C,+CAA+C;EAC/C,kDAAkD;AACpD","sourcesContent":["@import url('corrector/index.css');\n@import url('monitor/index.css');\n@import url('reviewer/index.css');\n@import url('ui/annotate.css');\n@import url('ui/boundary.css');\n@import url('ui/propagator.css');\n@import url('ui/sidebar.css');\n@import url('ui/toolbars.css');\n\n:root {\n  --correxit-correct-color: var(--jp-success-color1);\n  --correxit-incorrect-color: var(--jp-error-color1);\n  --correxit-insistent-color: var(--md-blue-400);\n  --correxit-partial-color: var(--jp-warn-color0);\n  --correxit-unscored-color: var(--jp-border-color1);\n}\n"],"sourceRoot":""}]);
// Exports
/* export default */ const __rspack_default_export = (___CSS_LOADER_EXPORT___);


},
"./node_modules/css-loader/dist/cjs.js!./style/monitor/index.css"(module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  "default": () => (__rspack_default_export)
});
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0 = __webpack_require__("./node_modules/css-loader/dist/runtime/sourceMaps.js");
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0);
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1 = __webpack_require__("./node_modules/css-loader/dist/runtime/api.js");
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__rspack_import_1);
// Imports


var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default()((_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default()));
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.correxit-overlay {
  background: var(--jp-dialog-background);
  height: 100%;
  left: 0;
  position: absolute;
  top: 0;
  width: 100%;
  z-index: 10;
}

.correxit-overlay.cxt-mod-choose {
  cursor: cell;
  overflow: hidden;
  padding: 0;
  pointer-events: all;
}

.correxit-overlay.cxt-mod-loading {
  align-items: center;
  background-color: var(--jp-layout-color0);
  display: flex;
  flex-direction: column;
  gap: 12px;
  justify-content: center;
  opacity: 0.85;
  pointer-events: all;
}

.correxit-overlay.cxt-mod-loading::before {
  animation: correxit-spin 0.8s linear infinite;
  border: 3px solid var(--jp-border-color2);
  border-radius: 50%;
  border-top-color: var(--jp-brand-color1);
  content: '';
  height: 28px;
  width: 28px;
}

.correxit-overlay.cxt-mod-loading::after {
  color: var(--jp-ui-font-color1);
  content: attr(data-label);
  font-size: var(--jp-ui-font-size1);
}

.correxit-chooser {
  background: linear-gradient(
    180deg,
    var(--jp-layout-color1) 0%,
    var(--jp-layout-color0) 100%
  );
  border: 1px solid var(--jp-brand-color2);
  border-radius: 8px;
  border-top-width: 3px;
  box-shadow:
    var(--jp-elevation-z8),
    0 0 0 1px rgb(0 0 0 / 6%);
  color: var(--jp-ui-font-color1);
  cursor: default;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 12px 16px;
  pointer-events: auto;
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100vw - 48px);
  max-width: 440px;
  z-index: 1;
}

.correxit-chooser-title,
.correxit-chooser-prompt,
.correxit-chooser-status {
  margin: 0;
}

.correxit-chooser-title {
  font-size: var(--jp-ui-font-size2);
}

.correxit-chooser-prompt {
  color: var(--jp-ui-font-color2);
  line-height: 1.4;
}

.correxit-chooser-status {
  background-color: rgb(0 0 0 / 4%);
  border-radius: 6px;
  padding: 8px 10px;
}

.correxit-chooser-status[data-state='empty'] {
  color: var(--jp-ui-font-color2);
}

.correxit-chooser-status[data-state='invalid'] {
  color: var(--jp-reject-color-active);
}

.correxit-chooser-status[data-state='valid'] {
  color: var(--jp-accept-color-active);
}

@keyframes correxit-spin {
  to {
    transform: rotate(360deg);
  }
}

.correxit-target-cell {
  --correxit-target-ring-width: 3px;

  border: none;
  border-radius: 2px;
  box-shadow: 0 0 0 var(--correxit-target-ring-width) transparent;
  outline: none;
}

.correxit-target-cell.cxt-mod-include {
  box-shadow: 0 0 0 var(--correxit-target-ring-width)
    var(--jp-accept-color-active);
}

.correxit-target-cell.cxt-mod-exclude {
  box-shadow: 0 0 0 var(--correxit-target-ring-width)
    var(--jp-reject-color-active);
}
`, "",{"version":3,"sources":["webpack://./style/monitor/index.css"],"names":[],"mappings":"AAAA;EACE,uCAAuC;EACvC,YAAY;EACZ,OAAO;EACP,kBAAkB;EAClB,MAAM;EACN,WAAW;EACX,WAAW;AACb;;AAEA;EACE,YAAY;EACZ,gBAAgB;EAChB,UAAU;EACV,mBAAmB;AACrB;;AAEA;EACE,mBAAmB;EACnB,yCAAyC;EACzC,aAAa;EACb,sBAAsB;EACtB,SAAS;EACT,uBAAuB;EACvB,aAAa;EACb,mBAAmB;AACrB;;AAEA;EACE,6CAA6C;EAC7C,yCAAyC;EACzC,kBAAkB;EAClB,wCAAwC;EACxC,WAAW;EACX,YAAY;EACZ,WAAW;AACb;;AAEA;EACE,+BAA+B;EAC/B,yBAAyB;EACzB,kCAAkC;AACpC;;AAEA;EACE;;;;GAIC;EACD,wCAAwC;EACxC,kBAAkB;EAClB,qBAAqB;EACrB;;6BAE2B;EAC3B,+BAA+B;EAC/B,eAAe;EACf,aAAa;EACb,sBAAsB;EACtB,QAAQ;EACR,8BAA8B;EAC9B,cAAc;EACd,kBAAkB;EAClB,oBAAoB;EACpB,eAAe;EACf,SAAS;EACT,SAAS;EACT,2BAA2B;EAC3B,yBAAyB;EACzB,gBAAgB;EAChB,UAAU;AACZ;;AAEA;;;EAGE,SAAS;AACX;;AAEA;EACE,kCAAkC;AACpC;;AAEA;EACE,+BAA+B;EAC/B,gBAAgB;AAClB;;AAEA;EACE,iCAAiC;EACjC,kBAAkB;EAClB,iBAAiB;AACnB;;AAEA;EACE,+BAA+B;AACjC;;AAEA;EACE,oCAAoC;AACtC;;AAEA;EACE,oCAAoC;AACtC;;AAEA;EACE;IACE,yBAAyB;EAC3B;AACF;;AAEA;EACE,iCAAiC;;EAEjC,YAAY;EACZ,kBAAkB;EAClB,+DAA+D;EAC/D,aAAa;AACf;;AAEA;EACE;iCAC+B;AACjC;;AAEA;EACE;iCAC+B;AACjC","sourcesContent":[".correxit-overlay {\n  background: var(--jp-dialog-background);\n  height: 100%;\n  left: 0;\n  position: absolute;\n  top: 0;\n  width: 100%;\n  z-index: 10;\n}\n\n.correxit-overlay.cxt-mod-choose {\n  cursor: cell;\n  overflow: hidden;\n  padding: 0;\n  pointer-events: all;\n}\n\n.correxit-overlay.cxt-mod-loading {\n  align-items: center;\n  background-color: var(--jp-layout-color0);\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  justify-content: center;\n  opacity: 0.85;\n  pointer-events: all;\n}\n\n.correxit-overlay.cxt-mod-loading::before {\n  animation: correxit-spin 0.8s linear infinite;\n  border: 3px solid var(--jp-border-color2);\n  border-radius: 50%;\n  border-top-color: var(--jp-brand-color1);\n  content: '';\n  height: 28px;\n  width: 28px;\n}\n\n.correxit-overlay.cxt-mod-loading::after {\n  color: var(--jp-ui-font-color1);\n  content: attr(data-label);\n  font-size: var(--jp-ui-font-size1);\n}\n\n.correxit-chooser {\n  background: linear-gradient(\n    180deg,\n    var(--jp-layout-color1) 0%,\n    var(--jp-layout-color0) 100%\n  );\n  border: 1px solid var(--jp-brand-color2);\n  border-radius: 8px;\n  border-top-width: 3px;\n  box-shadow:\n    var(--jp-elevation-z8),\n    0 0 0 1px rgb(0 0 0 / 6%);\n  color: var(--jp-ui-font-color1);\n  cursor: default;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  max-height: calc(100vh - 48px);\n  overflow: auto;\n  padding: 12px 16px;\n  pointer-events: auto;\n  position: fixed;\n  top: 24px;\n  left: 50%;\n  transform: translateX(-50%);\n  width: calc(100vw - 48px);\n  max-width: 440px;\n  z-index: 1;\n}\n\n.correxit-chooser-title,\n.correxit-chooser-prompt,\n.correxit-chooser-status {\n  margin: 0;\n}\n\n.correxit-chooser-title {\n  font-size: var(--jp-ui-font-size2);\n}\n\n.correxit-chooser-prompt {\n  color: var(--jp-ui-font-color2);\n  line-height: 1.4;\n}\n\n.correxit-chooser-status {\n  background-color: rgb(0 0 0 / 4%);\n  border-radius: 6px;\n  padding: 8px 10px;\n}\n\n.correxit-chooser-status[data-state='empty'] {\n  color: var(--jp-ui-font-color2);\n}\n\n.correxit-chooser-status[data-state='invalid'] {\n  color: var(--jp-reject-color-active);\n}\n\n.correxit-chooser-status[data-state='valid'] {\n  color: var(--jp-accept-color-active);\n}\n\n@keyframes correxit-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n.correxit-target-cell {\n  --correxit-target-ring-width: 3px;\n\n  border: none;\n  border-radius: 2px;\n  box-shadow: 0 0 0 var(--correxit-target-ring-width) transparent;\n  outline: none;\n}\n\n.correxit-target-cell.cxt-mod-include {\n  box-shadow: 0 0 0 var(--correxit-target-ring-width)\n    var(--jp-accept-color-active);\n}\n\n.correxit-target-cell.cxt-mod-exclude {\n  box-shadow: 0 0 0 var(--correxit-target-ring-width)\n    var(--jp-reject-color-active);\n}\n"],"sourceRoot":""}]);
// Exports
/* export default */ const __rspack_default_export = (___CSS_LOADER_EXPORT___);


},
"./node_modules/css-loader/dist/cjs.js!./style/reviewer/index.css"(module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  "default": () => (__rspack_default_export)
});
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0 = __webpack_require__("./node_modules/css-loader/dist/runtime/sourceMaps.js");
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0);
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1 = __webpack_require__("./node_modules/css-loader/dist/runtime/api.js");
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__rspack_import_1);
// Imports


var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default()((_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default()));
// Module
___CSS_LOADER_EXPORT___.push([module.id, `/* Reviewer widget container */

.correxit-reviewer-widget {
  background-color: var(--jp-layout-color1);
}

.correxit-reviewer-widget-content {
  height: 100%;
  overflow-y: auto;
  width: 100%;
}

/* Reviewer layout */

.correxit-reviewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

.correxit-reviewer-idle {
  align-items: center;
  display: flex;
  justify-content: center;

  p {
    color: var(--jp-ui-font-color2);
    font-family: var(--jp-ui-font-family);
    font-size: var(--jp-ui-font-size1);
  }
}

/* Toolbar info */

.correxit-reviewer-info {
  color: var(--jp-ui-font-color1);
  font-family: var(--jp-ui-font-family);
  font-size: var(--jp-ui-font-size1);
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Body: minimap + content */

.correxit-reviewer-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 0 16px;
}

/* Minimap */

.correxit-reviewer-minimap {
  align-content: start;
  box-sizing: border-box;
  border-bottom: 1px solid var(--jp-border-color1);
  gap: 1px 0;
  display: grid;
  min-height: 48px;
  overflow: hidden auto;
  padding: 8px 4px;
}

.correxit-reviewer-minimap-cell {
  appearance: none;
  background-image: linear-gradient(
    to right,
    transparent calc(100% - 1px),
    color-mix(in srgb, var(--jp-border-color2) 60%, transparent) 0
  );
  background-repeat: no-repeat;
  border: none;
  cursor: pointer;
  min-height: 3px;
  min-width: 0;
  padding: 0;
  position: relative;
  scroll-margin: 24px;
  transition:
    box-shadow 120ms ease,
    transform 120ms ease;

  &.correxit-reviewer-minimap-correct {
    background-color: var(--correxit-correct-color);
  }

  &.correxit-reviewer-minimap-incorrect {
    background-color: var(--correxit-incorrect-color);
  }

  &.correxit-reviewer-minimap-partial {
    background-color: var(--correxit-partial-color);
  }

  &.correxit-reviewer-minimap-review {
    background-color: var(--correxit-insistent-color);
  }

  &.correxit-reviewer-minimap-unscored {
    background-color: var(--correxit-unscored-color);
  }

  &.cxt-mod-active {
    box-shadow:
      0 0 0 1px var(--jp-layout-color1),
      0 0 0 2px var(--jp-brand-color1),
      0 0 0 3px color-mix(in srgb, var(--jp-brand-color1) 24%, transparent);
    transform: scale(1.25);
    z-index: 1;
  }

  &:focus-visible {
    box-shadow:
      0 0 0 1px var(--jp-layout-color1),
      0 0 0 3px var(--jp-brand-color1);
    outline: none;
  }
}

/* Content area */

.correxit-reviewer-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow-y: auto;
  padding: 8px 0;
}

/* Cell source */

.correxit-reviewer-source {
  border: 1px solid var(--jp-border-color1);
  border-left: 3px solid var(--jp-border-color2);
  border-radius: var(--jp-border-radius);
  margin-bottom: 8px;
  overflow-x: auto;

  pre {
    font-family: var(--jp-code-font-family);
    font-size: var(--jp-code-font-size);
    line-height: var(--jp-code-line-height);
    margin: 0;
    padding: 8px;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  &.cxt-cell-code {
    background-color: var(--jp-cell-editor-background);
    border-left-color: var(--jp-brand-color1);
  }

  &.cxt-cell-markdown {
    background-color: var(--jp-layout-color1);
    border-left-color: var(--jp-success-color1, var(--jp-brand-color2));
  }

  &.cxt-cell-raw {
    background-color: var(--jp-layout-color2);
    border-left-color: var(--jp-warn-color1, var(--jp-border-color2));
  }

  &.cxt-mod-question {
    border-left-color: var(--jp-border-color2);
    font-size: var(--jp-ui-font-size0);
    margin-bottom: 0;
    opacity: 0.7;
  }
}

.correxit-reviewer-source-blank {
  color: var(--jp-ui-font-color2);
  font-style: italic;
}

/* Certified (inert) state */

.correxit-reviewer-certified {
  align-items: center;
  border: 1px solid var(--jp-border-color1);
  border-radius: var(--jp-border-radius);
  display: flex;
  justify-content: center;
  padding: 8px;

  p {
    color: var(--jp-ui-font-color2);
    font-family: var(--jp-ui-font-family);
    font-size: var(--jp-ui-font-size1);
    margin: 0;
  }
}

/* Outputs */

.correxit-reviewer-outputs {
  border: 1px solid var(--jp-border-color1);
  border-radius: var(--jp-border-radius);
  margin-bottom: 8px;
  overflow-x: auto;
}

.correxit-reviewer-output {
  border-bottom: 1px solid var(--jp-border-color2);
  font-family: var(--jp-code-font-family);
  font-size: var(--jp-code-font-size);
  margin: 0;
  padding: 8px;
  white-space: pre-wrap;
  word-wrap: break-word;

  &:last-child {
    border-bottom: none;
  }
}

/* Scoring controls */

.correxit-reviewer-scoring {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.correxit-reviewer-comment {
  border: 1px solid var(--jp-border-color1);
  border-radius: var(--jp-border-radius);
  box-sizing: border-box;
  font-family: var(--jp-ui-font-family);
  font-size: var(--jp-ui-font-size1);
  padding: 4px 8px;
  resize: vertical;
  width: 100%;
}

.correxit-reviewer-scoring-grid {
  display: grid;
  gap: 4px;
  grid-template-columns: 1fr auto 1fr;

  .correxit-reviewer-score-display {
    align-items: center;
    display: flex;
    gap: 4px;
    justify-content: center;
  }
}

.correxit-reviewer-score-input {
  border: 1px solid var(--jp-border-color1);
  border-radius: var(--jp-border-radius);
  font-family: var(--jp-ui-font-family);
  font-size: var(--jp-ui-font-size1);
  padding: 2px 4px;
  text-align: center;
  width: 48px;
}

.correxit-reviewer-score-sep {
  color: var(--jp-ui-font-color2);
}

.correxit-reviewer-score-possible {
  color: var(--jp-ui-font-color2);
  font-family: var(--jp-ui-font-family);
  font-size: var(--jp-ui-font-size1);
}

/* Buttons */

.correxit-reviewer-btn {
  border: none;
  border-radius: var(--jp-border-radius);
  cursor: pointer;
  font-family: var(--jp-ui-font-family);
  font-size: var(--jp-ui-font-size1);
  padding: 4px 10px;

  .correxit-reviewer-scoring-grid & {
    display: flex;
    justify-content: space-between;
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }

  &:focus-visible {
    outline: 1px solid var(--jp-brand-color1);
    outline-offset: 2px;
  }
}

.correxit-reviewer-btn-fail {
  background-color: color-mix(
    in oklch,
    var(--correxit-incorrect-color),
    black 20%
  );
  color: #fff;

  &:hover {
    opacity: 0.85;
  }
}

.correxit-reviewer-btn-pass {
  background-color: color-mix(
    in oklch,
    var(--correxit-correct-color),
    black 20%
  );
  color: #fff;

  &:hover {
    opacity: 0.85;
  }

  &.cxt-mod-partial {
    background-color: color-mix(
      in oklch,
      var(--correxit-partial-color),
      black 25%
    );
  }
}

.correxit-reviewer-btn-run {
  background-color: color-mix(in oklch, var(--jp-brand-color1), black 20%);
  color: #fff;

  &:hover {
    background-color: var(--jp-brand-color0);
  }
}

.correxit-reviewer-grade {
  color: var(--jp-ui-font-color1);
  font-family: var(--jp-ui-font-family);
  font-size: var(--jp-ui-font-size1);
  padding: 2px 0;
  text-align: center;
}

/* Score badge (toolbar) */

.correxit-reviewer-badge {
  align-items: center;
  border-radius: 10px;
  color: var(--jp-ui-inverse-font-color0, #fff);
  display: inline-flex;
  font-family: var(--jp-ui-font-family);
  font-size: var(--jp-ui-font-size0);
  font-weight: 600;
  gap: 4px;
  line-height: 1;
  padding: 2px 8px;
  vertical-align: middle;
  white-space: nowrap;
}

.correxit-reviewer-badge-label {
  font-weight: 400;
  opacity: 0.85;
}

.correxit-reviewer-badge-correct {
  background-color: color-mix(
    in oklch,
    var(--correxit-correct-color),
    black 20%
  );
  color: #fff;
}

.correxit-reviewer-badge-incorrect {
  background-color: color-mix(
    in oklch,
    var(--correxit-incorrect-color),
    black 20%
  );
  color: #fff;
}

.correxit-reviewer-badge-partial {
  background-color: color-mix(
    in oklch,
    var(--correxit-partial-color),
    black 25%
  );
  color: #fff;
}

.correxit-reviewer-badge-unscored {
  background-color: var(--correxit-unscored-color);
  color: var(--jp-ui-font-color2);
}

.correxit-reviewer-badge-manual {
  border: 1.5px dashed var(--jp-ui-inverse-font-color2, rgb(255 255 255 / 60%));
}

.correxit-reviewer-badge-manual.correxit-reviewer-badge-unscored {
  border-color: var(--jp-ui-font-color3);
}

/* Breakdown segments: make clickable when in corrector */

.correxit-corrector-breakdown-segment {
  cursor: pointer;
}
`, "",{"version":3,"sources":["webpack://./style/reviewer/index.css"],"names":[],"mappings":"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","sourcesContent":["/* Reviewer widget container */\n\n.correxit-reviewer-widget {\n  background-color: var(--jp-layout-color1);\n}\n\n.correxit-reviewer-widget-content {\n  height: 100%;\n  overflow-y: auto;\n  width: 100%;\n}\n\n/* Reviewer layout */\n\n.correxit-reviewer {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  width: 100%;\n}\n\n.correxit-reviewer-idle {\n  align-items: center;\n  display: flex;\n  justify-content: center;\n\n  p {\n    color: var(--jp-ui-font-color2);\n    font-family: var(--jp-ui-font-family);\n    font-size: var(--jp-ui-font-size1);\n  }\n}\n\n/* Toolbar info */\n\n.correxit-reviewer-info {\n  color: var(--jp-ui-font-color1);\n  font-family: var(--jp-ui-font-family);\n  font-size: var(--jp-ui-font-size1);\n  margin-left: auto;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* Body: minimap + content */\n\n.correxit-reviewer-body {\n  display: flex;\n  flex: 1;\n  flex-direction: column;\n  min-height: 0;\n  overflow: hidden;\n  padding: 0 16px;\n}\n\n/* Minimap */\n\n.correxit-reviewer-minimap {\n  align-content: start;\n  box-sizing: border-box;\n  border-bottom: 1px solid var(--jp-border-color1);\n  gap: 1px 0;\n  display: grid;\n  min-height: 48px;\n  overflow: hidden auto;\n  padding: 8px 4px;\n}\n\n.correxit-reviewer-minimap-cell {\n  appearance: none;\n  background-image: linear-gradient(\n    to right,\n    transparent calc(100% - 1px),\n    color-mix(in srgb, var(--jp-border-color2) 60%, transparent) 0\n  );\n  background-repeat: no-repeat;\n  border: none;\n  cursor: pointer;\n  min-height: 3px;\n  min-width: 0;\n  padding: 0;\n  position: relative;\n  scroll-margin: 24px;\n  transition:\n    box-shadow 120ms ease,\n    transform 120ms ease;\n\n  &.correxit-reviewer-minimap-correct {\n    background-color: var(--correxit-correct-color);\n  }\n\n  &.correxit-reviewer-minimap-incorrect {\n    background-color: var(--correxit-incorrect-color);\n  }\n\n  &.correxit-reviewer-minimap-partial {\n    background-color: var(--correxit-partial-color);\n  }\n\n  &.correxit-reviewer-minimap-review {\n    background-color: var(--correxit-insistent-color);\n  }\n\n  &.correxit-reviewer-minimap-unscored {\n    background-color: var(--correxit-unscored-color);\n  }\n\n  &.cxt-mod-active {\n    box-shadow:\n      0 0 0 1px var(--jp-layout-color1),\n      0 0 0 2px var(--jp-brand-color1),\n      0 0 0 3px color-mix(in srgb, var(--jp-brand-color1) 24%, transparent);\n    transform: scale(1.25);\n    z-index: 1;\n  }\n\n  &:focus-visible {\n    box-shadow:\n      0 0 0 1px var(--jp-layout-color1),\n      0 0 0 3px var(--jp-brand-color1);\n    outline: none;\n  }\n}\n\n/* Content area */\n\n.correxit-reviewer-content {\n  display: flex;\n  flex: 1;\n  flex-direction: column;\n  min-width: 0;\n  overflow-y: auto;\n  padding: 8px 0;\n}\n\n/* Cell source */\n\n.correxit-reviewer-source {\n  border: 1px solid var(--jp-border-color1);\n  border-left: 3px solid var(--jp-border-color2);\n  border-radius: var(--jp-border-radius);\n  margin-bottom: 8px;\n  overflow-x: auto;\n\n  pre {\n    font-family: var(--jp-code-font-family);\n    font-size: var(--jp-code-font-size);\n    line-height: var(--jp-code-line-height);\n    margin: 0;\n    padding: 8px;\n    white-space: pre-wrap;\n    word-wrap: break-word;\n  }\n\n  &.cxt-cell-code {\n    background-color: var(--jp-cell-editor-background);\n    border-left-color: var(--jp-brand-color1);\n  }\n\n  &.cxt-cell-markdown {\n    background-color: var(--jp-layout-color1);\n    border-left-color: var(--jp-success-color1, var(--jp-brand-color2));\n  }\n\n  &.cxt-cell-raw {\n    background-color: var(--jp-layout-color2);\n    border-left-color: var(--jp-warn-color1, var(--jp-border-color2));\n  }\n\n  &.cxt-mod-question {\n    border-left-color: var(--jp-border-color2);\n    font-size: var(--jp-ui-font-size0);\n    margin-bottom: 0;\n    opacity: 0.7;\n  }\n}\n\n.correxit-reviewer-source-blank {\n  color: var(--jp-ui-font-color2);\n  font-style: italic;\n}\n\n/* Certified (inert) state */\n\n.correxit-reviewer-certified {\n  align-items: center;\n  border: 1px solid var(--jp-border-color1);\n  border-radius: var(--jp-border-radius);\n  display: flex;\n  justify-content: center;\n  padding: 8px;\n\n  p {\n    color: var(--jp-ui-font-color2);\n    font-family: var(--jp-ui-font-family);\n    font-size: var(--jp-ui-font-size1);\n    margin: 0;\n  }\n}\n\n/* Outputs */\n\n.correxit-reviewer-outputs {\n  border: 1px solid var(--jp-border-color1);\n  border-radius: var(--jp-border-radius);\n  margin-bottom: 8px;\n  overflow-x: auto;\n}\n\n.correxit-reviewer-output {\n  border-bottom: 1px solid var(--jp-border-color2);\n  font-family: var(--jp-code-font-family);\n  font-size: var(--jp-code-font-size);\n  margin: 0;\n  padding: 8px;\n  white-space: pre-wrap;\n  word-wrap: break-word;\n\n  &:last-child {\n    border-bottom: none;\n  }\n}\n\n/* Scoring controls */\n\n.correxit-reviewer-scoring {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n.correxit-reviewer-comment {\n  border: 1px solid var(--jp-border-color1);\n  border-radius: var(--jp-border-radius);\n  box-sizing: border-box;\n  font-family: var(--jp-ui-font-family);\n  font-size: var(--jp-ui-font-size1);\n  padding: 4px 8px;\n  resize: vertical;\n  width: 100%;\n}\n\n.correxit-reviewer-scoring-grid {\n  display: grid;\n  gap: 4px;\n  grid-template-columns: 1fr auto 1fr;\n\n  .correxit-reviewer-score-display {\n    align-items: center;\n    display: flex;\n    gap: 4px;\n    justify-content: center;\n  }\n}\n\n.correxit-reviewer-score-input {\n  border: 1px solid var(--jp-border-color1);\n  border-radius: var(--jp-border-radius);\n  font-family: var(--jp-ui-font-family);\n  font-size: var(--jp-ui-font-size1);\n  padding: 2px 4px;\n  text-align: center;\n  width: 48px;\n}\n\n.correxit-reviewer-score-sep {\n  color: var(--jp-ui-font-color2);\n}\n\n.correxit-reviewer-score-possible {\n  color: var(--jp-ui-font-color2);\n  font-family: var(--jp-ui-font-family);\n  font-size: var(--jp-ui-font-size1);\n}\n\n/* Buttons */\n\n.correxit-reviewer-btn {\n  border: none;\n  border-radius: var(--jp-border-radius);\n  cursor: pointer;\n  font-family: var(--jp-ui-font-family);\n  font-size: var(--jp-ui-font-size1);\n  padding: 4px 10px;\n\n  .correxit-reviewer-scoring-grid & {\n    display: flex;\n    justify-content: space-between;\n  }\n\n  &:disabled {\n    cursor: default;\n    opacity: 0.5;\n  }\n\n  &:focus-visible {\n    outline: 1px solid var(--jp-brand-color1);\n    outline-offset: 2px;\n  }\n}\n\n.correxit-reviewer-btn-fail {\n  background-color: color-mix(\n    in oklch,\n    var(--correxit-incorrect-color),\n    black 20%\n  );\n  color: #fff;\n\n  &:hover {\n    opacity: 0.85;\n  }\n}\n\n.correxit-reviewer-btn-pass {\n  background-color: color-mix(\n    in oklch,\n    var(--correxit-correct-color),\n    black 20%\n  );\n  color: #fff;\n\n  &:hover {\n    opacity: 0.85;\n  }\n\n  &.cxt-mod-partial {\n    background-color: color-mix(\n      in oklch,\n      var(--correxit-partial-color),\n      black 25%\n    );\n  }\n}\n\n.correxit-reviewer-btn-run {\n  background-color: color-mix(in oklch, var(--jp-brand-color1), black 20%);\n  color: #fff;\n\n  &:hover {\n    background-color: var(--jp-brand-color0);\n  }\n}\n\n.correxit-reviewer-grade {\n  color: var(--jp-ui-font-color1);\n  font-family: var(--jp-ui-font-family);\n  font-size: var(--jp-ui-font-size1);\n  padding: 2px 0;\n  text-align: center;\n}\n\n/* Score badge (toolbar) */\n\n.correxit-reviewer-badge {\n  align-items: center;\n  border-radius: 10px;\n  color: var(--jp-ui-inverse-font-color0, #fff);\n  display: inline-flex;\n  font-family: var(--jp-ui-font-family);\n  font-size: var(--jp-ui-font-size0);\n  font-weight: 600;\n  gap: 4px;\n  line-height: 1;\n  padding: 2px 8px;\n  vertical-align: middle;\n  white-space: nowrap;\n}\n\n.correxit-reviewer-badge-label {\n  font-weight: 400;\n  opacity: 0.85;\n}\n\n.correxit-reviewer-badge-correct {\n  background-color: color-mix(\n    in oklch,\n    var(--correxit-correct-color),\n    black 20%\n  );\n  color: #fff;\n}\n\n.correxit-reviewer-badge-incorrect {\n  background-color: color-mix(\n    in oklch,\n    var(--correxit-incorrect-color),\n    black 20%\n  );\n  color: #fff;\n}\n\n.correxit-reviewer-badge-partial {\n  background-color: color-mix(\n    in oklch,\n    var(--correxit-partial-color),\n    black 25%\n  );\n  color: #fff;\n}\n\n.correxit-reviewer-badge-unscored {\n  background-color: var(--correxit-unscored-color);\n  color: var(--jp-ui-font-color2);\n}\n\n.correxit-reviewer-badge-manual {\n  border: 1.5px dashed var(--jp-ui-inverse-font-color2, rgb(255 255 255 / 60%));\n}\n\n.correxit-reviewer-badge-manual.correxit-reviewer-badge-unscored {\n  border-color: var(--jp-ui-font-color3);\n}\n\n/* Breakdown segments: make clickable when in corrector */\n\n.correxit-corrector-breakdown-segment {\n  cursor: pointer;\n}\n"],"sourceRoot":""}]);
// Exports
/* export default */ const __rspack_default_export = (___CSS_LOADER_EXPORT___);


},
"./node_modules/css-loader/dist/cjs.js!./style/ui/annotate.css"(module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  "default": () => (__rspack_default_export)
});
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0 = __webpack_require__("./node_modules/css-loader/dist/runtime/sourceMaps.js");
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0);
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1 = __webpack_require__("./node_modules/css-loader/dist/runtime/api.js");
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__rspack_import_1);
/* import */ var _node_modules_css_loader_dist_runtime_getUrl_js__rspack_import_2 = __webpack_require__("./node_modules/css-loader/dist/runtime/getUrl.js");
/* import */ var _node_modules_css_loader_dist_runtime_getUrl_js__rspack_import_2_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_getUrl_js__rspack_import_2);
// Imports



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */__webpack_require__("./style/monitor/icons/answerable.svg?f361"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_1___ = new URL(/* asset import */__webpack_require__("./style/monitor/icons/comparable.svg?3cf5"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_2___ = new URL(/* asset import */__webpack_require__("./style/monitor/icons/correctable.svg?75e6"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_3___ = new URL(/* asset import */__webpack_require__("./style/monitor/icons/reviewable.svg?8c06"), __webpack_require__.b);
var ___CSS_LOADER_URL_IMPORT_4___ = new URL(/* asset import */__webpack_require__("./style/monitor/icons/locked.svg?bc25"), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default()((_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__rspack_import_2_default()(___CSS_LOADER_URL_IMPORT_0___);
var ___CSS_LOADER_URL_REPLACEMENT_1___ = _node_modules_css_loader_dist_runtime_getUrl_js__rspack_import_2_default()(___CSS_LOADER_URL_IMPORT_1___);
var ___CSS_LOADER_URL_REPLACEMENT_2___ = _node_modules_css_loader_dist_runtime_getUrl_js__rspack_import_2_default()(___CSS_LOADER_URL_IMPORT_2___);
var ___CSS_LOADER_URL_REPLACEMENT_3___ = _node_modules_css_loader_dist_runtime_getUrl_js__rspack_import_2_default()(___CSS_LOADER_URL_IMPORT_3___);
var ___CSS_LOADER_URL_REPLACEMENT_4___ = _node_modules_css_loader_dist_runtime_getUrl_js__rspack_import_2_default()(___CSS_LOADER_URL_IMPORT_4___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `/* Cell-type annotation badges. */

.jp-Cell:not(.jp-mod-active).cxt-mod-answerable::after,
.jp-Cell:not(.jp-mod-active).cxt-mod-comparable::after,
.jp-Cell:not(.jp-mod-active).cxt-mod-correctable::after,
.jp-Cell:not(.jp-mod-active).cxt-mod-reviewable::after {
  --cxt-annotate-size: 28px;
  --cxt-annotate-icon: 16px 16px;

  border-top-right-radius: var(--jp-border-radius);
  border-bottom-right-radius: var(--jp-border-radius);
  content: '';
  position: absolute;
  top: 6px;
  right: 5px;
  z-index: 10;
  background-color: var(--correxit-insistent-color);
  box-shadow: none;
  width: var(--cxt-annotate-size);
  height: var(--cxt-annotate-size);
  background-position: center;
  background-repeat: no-repeat;
  background-size: var(--cxt-annotate-icon);
  pointer-events: none;
}

.jp-Cell:not(.jp-mod-active).cxt-mod-answerable::after {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_0___});
}

.jp-Cell:not(.jp-mod-active).cxt-mod-comparable::after {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_1___});
}

.jp-Cell:not(.jp-mod-active).cxt-mod-correctable::after {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_2___});
}

.jp-Cell:not(.jp-mod-active).cxt-mod-reviewable::after {
  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_3___});
}

/* Encrypted cell overlay (secret references and sealed submissions). */

.jp-Notebook .jp-Cell.cxt-mod-encrypted .jp-Placeholder-content,
.jp-Notebook .jp-Cell.cxt-mod-encrypted .jp-InputArea-editor {
  position: relative;
}

.jp-Notebook .jp-Cell.cxt-mod-encrypted .jp-Placeholder-content::before,
.jp-Notebook .jp-Cell.cxt-mod-encrypted .jp-InputArea-editor::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 5;
  background:
    repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 4px,
      rgb(128 128 128 / 40%) 4px,
      rgb(128 128 128 / 40%) 5px
    ),
    repeating-linear-gradient(
      45deg,
      transparent,
      transparent 4px,
      rgb(128 128 128 / 40%) 4px,
      rgb(128 128 128 / 40%) 5px
    ),
    rgb(128 128 128 / 15%);
  border-radius: inherit;
  pointer-events: none;
}

.jp-Notebook .jp-Cell.cxt-mod-encrypted .jp-Placeholder-content::after,
.jp-Notebook .jp-Cell.cxt-mod-encrypted .jp-InputArea-editor::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 6;
  background-color: var(--correxit-insistent-color);
  mask: url(${___CSS_LOADER_URL_REPLACEMENT_4___}) center / contain no-repeat;
  pointer-events: none;
}

/* Score borders. */

.jp-Notebook .jp-Cell.cxt-mod-correct .jp-InputArea-editor {
  border: 1px solid var(--correxit-correct-color);
  border-radius: 6px;
}

.jp-Notebook .jp-Cell.cxt-mod-incorrect .jp-InputArea-editor {
  border: 1px solid var(--correxit-incorrect-color);
  border-radius: 6px;
}

.jp-Notebook .jp-Cell.cxt-mod-partial .jp-InputArea-editor {
  border: 1px solid var(--correxit-partial-color);
  border-radius: 6px;
}
`, "",{"version":3,"sources":["webpack://./style/ui/annotate.css"],"names":[],"mappings":"AAAA,iCAAiC;;AAEjC;;;;EAIE,yBAAyB;EACzB,8BAA8B;;EAE9B,gDAAgD;EAChD,mDAAmD;EACnD,WAAW;EACX,kBAAkB;EAClB,QAAQ;EACR,UAAU;EACV,WAAW;EACX,iDAAiD;EACjD,gBAAgB;EAChB,+BAA+B;EAC/B,gCAAgC;EAChC,2BAA2B;EAC3B,4BAA4B;EAC5B,yCAAyC;EACzC,oBAAoB;AACtB;;AAEA;EACE,yDAAwD;AAC1D;;AAEA;EACE,yDAAwD;AAC1D;;AAEA;EACE,yDAAyD;AAC3D;;AAEA;EACE,yDAAwD;AAC1D;;AAEA,uEAAuE;;AAEvE;;EAEE,kBAAkB;AACpB;;AAEA;;EAEE,WAAW;EACX,kBAAkB;EAClB,QAAQ;EACR,UAAU;EACV;;;;;;;;;;;;;;;0BAewB;EACxB,sBAAsB;EACtB,oBAAoB;AACtB;;AAEA;;EAEE,WAAW;EACX,kBAAkB;EAClB,QAAQ;EACR,UAAU;EACV,iDAAiD;EACjD,wEAAmE;EACnE,oBAAoB;AACtB;;AAEA,mBAAmB;;AAEnB;EACE,+CAA+C;EAC/C,kBAAkB;AACpB;;AAEA;EACE,iDAAiD;EACjD,kBAAkB;AACpB;;AAEA;EACE,+CAA+C;EAC/C,kBAAkB;AACpB","sourcesContent":["/* Cell-type annotation badges. */\n\n.jp-Cell:not(.jp-mod-active).cxt-mod-answerable::after,\n.jp-Cell:not(.jp-mod-active).cxt-mod-comparable::after,\n.jp-Cell:not(.jp-mod-active).cxt-mod-correctable::after,\n.jp-Cell:not(.jp-mod-active).cxt-mod-reviewable::after {\n  --cxt-annotate-size: 28px;\n  --cxt-annotate-icon: 16px 16px;\n\n  border-top-right-radius: var(--jp-border-radius);\n  border-bottom-right-radius: var(--jp-border-radius);\n  content: '';\n  position: absolute;\n  top: 6px;\n  right: 5px;\n  z-index: 10;\n  background-color: var(--correxit-insistent-color);\n  box-shadow: none;\n  width: var(--cxt-annotate-size);\n  height: var(--cxt-annotate-size);\n  background-position: center;\n  background-repeat: no-repeat;\n  background-size: var(--cxt-annotate-icon);\n  pointer-events: none;\n}\n\n.jp-Cell:not(.jp-mod-active).cxt-mod-answerable::after {\n  background-image: url('../monitor/icons/answerable.svg');\n}\n\n.jp-Cell:not(.jp-mod-active).cxt-mod-comparable::after {\n  background-image: url('../monitor/icons/comparable.svg');\n}\n\n.jp-Cell:not(.jp-mod-active).cxt-mod-correctable::after {\n  background-image: url('../monitor/icons/correctable.svg');\n}\n\n.jp-Cell:not(.jp-mod-active).cxt-mod-reviewable::after {\n  background-image: url('../monitor/icons/reviewable.svg');\n}\n\n/* Encrypted cell overlay (secret references and sealed submissions). */\n\n.jp-Notebook .jp-Cell.cxt-mod-encrypted .jp-Placeholder-content,\n.jp-Notebook .jp-Cell.cxt-mod-encrypted .jp-InputArea-editor {\n  position: relative;\n}\n\n.jp-Notebook .jp-Cell.cxt-mod-encrypted .jp-Placeholder-content::before,\n.jp-Notebook .jp-Cell.cxt-mod-encrypted .jp-InputArea-editor::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  z-index: 5;\n  background:\n    repeating-linear-gradient(\n      -45deg,\n      transparent,\n      transparent 4px,\n      rgb(128 128 128 / 40%) 4px,\n      rgb(128 128 128 / 40%) 5px\n    ),\n    repeating-linear-gradient(\n      45deg,\n      transparent,\n      transparent 4px,\n      rgb(128 128 128 / 40%) 4px,\n      rgb(128 128 128 / 40%) 5px\n    ),\n    rgb(128 128 128 / 15%);\n  border-radius: inherit;\n  pointer-events: none;\n}\n\n.jp-Notebook .jp-Cell.cxt-mod-encrypted .jp-Placeholder-content::after,\n.jp-Notebook .jp-Cell.cxt-mod-encrypted .jp-InputArea-editor::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  z-index: 6;\n  background-color: var(--correxit-insistent-color);\n  mask: url('../monitor/icons/locked.svg') center / contain no-repeat;\n  pointer-events: none;\n}\n\n/* Score borders. */\n\n.jp-Notebook .jp-Cell.cxt-mod-correct .jp-InputArea-editor {\n  border: 1px solid var(--correxit-correct-color);\n  border-radius: 6px;\n}\n\n.jp-Notebook .jp-Cell.cxt-mod-incorrect .jp-InputArea-editor {\n  border: 1px solid var(--correxit-incorrect-color);\n  border-radius: 6px;\n}\n\n.jp-Notebook .jp-Cell.cxt-mod-partial .jp-InputArea-editor {\n  border: 1px solid var(--correxit-partial-color);\n  border-radius: 6px;\n}\n"],"sourceRoot":""}]);
// Exports
/* export default */ const __rspack_default_export = (___CSS_LOADER_EXPORT___);


},
"./node_modules/css-loader/dist/cjs.js!./style/ui/boundary.css"(module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  "default": () => (__rspack_default_export)
});
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0 = __webpack_require__("./node_modules/css-loader/dist/runtime/sourceMaps.js");
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0);
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1 = __webpack_require__("./node_modules/css-loader/dist/runtime/api.js");
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__rspack_import_1);
// Imports


var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default()((_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default()));
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.correxit-boundary {
  padding: 12px;
  overflow: auto;
}

.correxit-boundary-label {
  color: var(--jp-ui-font-color1);
  font-size: var(--jp-ui-font-size1);
  margin: 0 0 8px;
}

.correxit-boundary-detail {
  background: var(--jp-layout-color2);
  border: 1px solid var(--jp-border-color1);
  border-radius: 2px;
  color: var(--jp-error-color1);
  font-size: var(--jp-code-font-size);
  margin: 0 0 8px;
  overflow: auto;
  padding: 8px;
  white-space: pre-wrap;
}

.correxit-boundary-stack {
  background: var(--jp-layout-color2);
  border: 1px solid var(--jp-border-color1);
  border-radius: 2px;
  color: var(--jp-ui-font-color2);
  font-size: var(--jp-code-font-size);
  margin: 4px 0 0;
  overflow: auto;
  padding: 8px;
  white-space: pre-wrap;
}
`, "",{"version":3,"sources":["webpack://./style/ui/boundary.css"],"names":[],"mappings":"AAAA;EACE,aAAa;EACb,cAAc;AAChB;;AAEA;EACE,+BAA+B;EAC/B,kCAAkC;EAClC,eAAe;AACjB;;AAEA;EACE,mCAAmC;EACnC,yCAAyC;EACzC,kBAAkB;EAClB,6BAA6B;EAC7B,mCAAmC;EACnC,eAAe;EACf,cAAc;EACd,YAAY;EACZ,qBAAqB;AACvB;;AAEA;EACE,mCAAmC;EACnC,yCAAyC;EACzC,kBAAkB;EAClB,+BAA+B;EAC/B,mCAAmC;EACnC,eAAe;EACf,cAAc;EACd,YAAY;EACZ,qBAAqB;AACvB","sourcesContent":[".correxit-boundary {\n  padding: 12px;\n  overflow: auto;\n}\n\n.correxit-boundary-label {\n  color: var(--jp-ui-font-color1);\n  font-size: var(--jp-ui-font-size1);\n  margin: 0 0 8px;\n}\n\n.correxit-boundary-detail {\n  background: var(--jp-layout-color2);\n  border: 1px solid var(--jp-border-color1);\n  border-radius: 2px;\n  color: var(--jp-error-color1);\n  font-size: var(--jp-code-font-size);\n  margin: 0 0 8px;\n  overflow: auto;\n  padding: 8px;\n  white-space: pre-wrap;\n}\n\n.correxit-boundary-stack {\n  background: var(--jp-layout-color2);\n  border: 1px solid var(--jp-border-color1);\n  border-radius: 2px;\n  color: var(--jp-ui-font-color2);\n  font-size: var(--jp-code-font-size);\n  margin: 4px 0 0;\n  overflow: auto;\n  padding: 8px;\n  white-space: pre-wrap;\n}\n"],"sourceRoot":""}]);
// Exports
/* export default */ const __rspack_default_export = (___CSS_LOADER_EXPORT___);


},
"./node_modules/css-loader/dist/cjs.js!./style/ui/propagator.css"(module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  "default": () => (__rspack_default_export)
});
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0 = __webpack_require__("./node_modules/css-loader/dist/runtime/sourceMaps.js");
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0);
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1 = __webpack_require__("./node_modules/css-loader/dist/runtime/api.js");
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__rspack_import_1);
// Imports


var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default()((_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default()));
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.correxit-propagator {
  padding: 8px;
  height: 100%;
}

.correxit-propagator-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.correxit-propagator-header {
  display: flex;
  align-items: center;
  gap: 4px;
}

.correxit-propagator-title {
  flex: 1;
  font-size: var(--jp-ui-font-size1);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.correxit-propagator-content pre {
  background-color: var(--jp-layout-color2);
  border: 1px solid var(--jp-border-color2);
  color: var(--jp-ui-font-color2);
  flex: 1;
  font-size: var(--jp-ui-font-size0);
  min-height: 80px;
  overflow: hidden auto;
  padding: 2px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.correxit-propagator-controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.correxit-propagator-controls progress {
  flex: 1;
}

.correxit-propagator-progress {
  align-items: center;
  display: flex;
  font-size: var(--jp-ui-font-size0);
  gap: 6px;
}

.correxit-propagator-button {
  appearance: none;
  border: none;
  border-radius: 2px;
  color: var(--jp-ui-inverse-font-color1, #fff);
  cursor: pointer;
  font-size: var(--jp-ui-font-size1);
  padding: 6px 0;
  transition: background-color 150ms ease;
  width: 100%;
}

.correxit-propagator-cancel {
  background-color: var(--jp-error-color1);
}

.correxit-propagator-cancel:hover {
  background-color: var(--jp-error-color0);
}

.correxit-propagator-retry {
  background-color: var(--jp-brand-color1);
}

.correxit-propagator-retry:hover {
  background-color: var(--jp-brand-color0);
}

.correxit-propagator-button:disabled {
  cursor: default;
  opacity: 0.7;
}

.correxit-propagator-button:focus-visible {
  outline: 2px solid var(--jp-brand-color1);
  outline-offset: 2px;
}

.correxit-propagator-notice {
  color: var(--jp-ui-font-color2);
  display: block;
  font-size: var(--jp-ui-font-size0);
  padding: 4px 0;
}
`, "",{"version":3,"sources":["webpack://./style/ui/propagator.css"],"names":[],"mappings":"AAAA;EACE,YAAY;EACZ,YAAY;AACd;;AAEA;EACE,aAAa;EACb,sBAAsB;EACtB,YAAY;AACd;;AAEA;EACE,aAAa;EACb,mBAAmB;EACnB,QAAQ;AACV;;AAEA;EACE,OAAO;EACP,kCAAkC;EAClC,gBAAgB;EAChB,gBAAgB;EAChB,uBAAuB;EACvB,mBAAmB;AACrB;;AAEA;EACE,yCAAyC;EACzC,yCAAyC;EACzC,+BAA+B;EAC/B,OAAO;EACP,kCAAkC;EAClC,gBAAgB;EAChB,qBAAqB;EACrB,YAAY;EACZ,uBAAuB;EACvB,mBAAmB;AACrB;;AAEA;EACE,aAAa;EACb,sBAAsB;EACtB,QAAQ;EACR,cAAc;AAChB;;AAEA;EACE,OAAO;AACT;;AAEA;EACE,mBAAmB;EACnB,aAAa;EACb,kCAAkC;EAClC,QAAQ;AACV;;AAEA;EACE,gBAAgB;EAChB,YAAY;EACZ,kBAAkB;EAClB,6CAA6C;EAC7C,eAAe;EACf,kCAAkC;EAClC,cAAc;EACd,uCAAuC;EACvC,WAAW;AACb;;AAEA;EACE,wCAAwC;AAC1C;;AAEA;EACE,wCAAwC;AAC1C;;AAEA;EACE,wCAAwC;AAC1C;;AAEA;EACE,wCAAwC;AAC1C;;AAEA;EACE,eAAe;EACf,YAAY;AACd;;AAEA;EACE,yCAAyC;EACzC,mBAAmB;AACrB;;AAEA;EACE,+BAA+B;EAC/B,cAAc;EACd,kCAAkC;EAClC,cAAc;AAChB","sourcesContent":[".correxit-propagator {\n  padding: 8px;\n  height: 100%;\n}\n\n.correxit-propagator-content {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n}\n\n.correxit-propagator-header {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.correxit-propagator-title {\n  flex: 1;\n  font-size: var(--jp-ui-font-size1);\n  font-weight: 600;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.correxit-propagator-content pre {\n  background-color: var(--jp-layout-color2);\n  border: 1px solid var(--jp-border-color2);\n  color: var(--jp-ui-font-color2);\n  flex: 1;\n  font-size: var(--jp-ui-font-size0);\n  min-height: 80px;\n  overflow: hidden auto;\n  padding: 2px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.correxit-propagator-controls {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  padding: 4px 0;\n}\n\n.correxit-propagator-controls progress {\n  flex: 1;\n}\n\n.correxit-propagator-progress {\n  align-items: center;\n  display: flex;\n  font-size: var(--jp-ui-font-size0);\n  gap: 6px;\n}\n\n.correxit-propagator-button {\n  appearance: none;\n  border: none;\n  border-radius: 2px;\n  color: var(--jp-ui-inverse-font-color1, #fff);\n  cursor: pointer;\n  font-size: var(--jp-ui-font-size1);\n  padding: 6px 0;\n  transition: background-color 150ms ease;\n  width: 100%;\n}\n\n.correxit-propagator-cancel {\n  background-color: var(--jp-error-color1);\n}\n\n.correxit-propagator-cancel:hover {\n  background-color: var(--jp-error-color0);\n}\n\n.correxit-propagator-retry {\n  background-color: var(--jp-brand-color1);\n}\n\n.correxit-propagator-retry:hover {\n  background-color: var(--jp-brand-color0);\n}\n\n.correxit-propagator-button:disabled {\n  cursor: default;\n  opacity: 0.7;\n}\n\n.correxit-propagator-button:focus-visible {\n  outline: 2px solid var(--jp-brand-color1);\n  outline-offset: 2px;\n}\n\n.correxit-propagator-notice {\n  color: var(--jp-ui-font-color2);\n  display: block;\n  font-size: var(--jp-ui-font-size0);\n  padding: 4px 0;\n}\n"],"sourceRoot":""}]);
// Exports
/* export default */ const __rspack_default_export = (___CSS_LOADER_EXPORT___);


},
"./node_modules/css-loader/dist/cjs.js!./style/ui/sidebar.css"(module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  "default": () => (__rspack_default_export)
});
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0 = __webpack_require__("./node_modules/css-loader/dist/runtime/sourceMaps.js");
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0);
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1 = __webpack_require__("./node_modules/css-loader/dist/runtime/api.js");
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__rspack_import_1);
// Imports


var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default()((_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default()));
// Module
___CSS_LOADER_EXPORT___.push([module.id, `#correxit-sidebar.correxit-sidebar {
  min-width: 285px;
}

.correxit-sidebar {
  --correxit-sidebar-content-inset: 2px;
  --correxit-sidebar-control-width: 100%;
  --correxit-sidebar-font-size: var(--jp-ui-font-size1);
  --correxit-sidebar-section-padding: 6px;

  display: flex;
  flex-flow: column;
  min-height: 0;
  overflow: hidden auto;
}

.correxit-sidebar input,
.correxit-sidebar select,
.correxit-sidebar textarea {
  box-sizing: border-box;
  max-width: 100%;
}

.correxit-sidebar h4 {
  font-size: var(--correxit-sidebar-font-size);
  font-weight: 600;
}

.correxit-sidebar h5 {
  font-size: var(--correxit-sidebar-font-size);
  margin: 0;
  font-weight: 300 !important;
}

.correxit-sidebar > section {
  padding: var(--correxit-sidebar-section-padding);
}

.correxit-sidebar > section.correxit-sidebar-body {
  flex: 1;
}

.correxit-sidebar-body > textarea {
  background-color: var(--jp-layout-color2);
  color: var(--jp-ui-font-color2);
  display: block;
  font-size: var(--correxit-sidebar-font-size);
  height: 35px;
  margin: 0 var(--correxit-sidebar-content-inset) 10px;
  overflow-y: auto;
  width: calc(100% - (2 * var(--correxit-sidebar-content-inset)));
}

.correxit-sidebar .correxit-monospace {
  background-color: var(--jp-layout-color2);
  font-family: var(--jp-code-font-family);
  font-size: var(--correxit-sidebar-font-size);
  margin: 2px 0;
  overflow: hidden;
  padding: 5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.correxit-sidebar-cell-report {
  align-items: center;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  margin: 6px var(--correxit-sidebar-content-inset) 8px;
}

.correxit-sidebar-cell-config {
  color: var(--jp-ui-font-color3);
  display: flex;
  gap: 4px;
  text-align: center;
}

.correxit-sidebar-cell-config .jp-ToolbarButtonComponent {
  flex: 1;
  margin: 0;
  min-width: 0;
}

.correxit-sidebar-cell-actions .jp-ToolbarButtonComponent {
  margin: 0;
  min-width: 0;
  width: 100%;
}

.correxit-sidebar-cell-actions {
  display: grid;
  gap: 4px;
  grid-template-columns: 1fr 1fr;
}

.correxit-sidebar-cell-pair {
  display: grid;
  gap: 4px;
  grid-template-columns: repeat(auto-fit, minmax(calc(50% - 2px), 1fr));
}

.correxit-sidebar-cell-pair .jp-ToolbarButtonComponent {
  margin: 0;
  min-width: 0;
  width: 100%;
}

.correxit-assignment-chip {
  background-color: var(--jp-layout-color4);
  border: 1px solid var(--jp-border-color3);
  border-radius: 3px;
  color: var(--jp-ui-font-color2);
  display: block;
  font-size: var(--jp-ui-font-size0);
  margin: 2px var(--correxit-sidebar-content-inset);
  overflow: hidden;
  padding: 4px 6px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.correxit-sidebar .jp-ToolbarButtonComponent > span {
  color: var(--jp-inverse-layout-color);
  font-size: var(--correxit-sidebar-font-size);
}

.correxit-sidebar .jp-ToolbarButtonComponent svg {
  margin-right: 5px;
}

.correxit-sidebar .jp-ToolbarButtonComponent.lm-mod-hidden {
  display: none;
}

.correxit-assignment-propagate {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px var(--correxit-sidebar-content-inset) 0;
}

.correxit-assignment-overwrite {
  align-items: center;
  display: flex;
  gap: 6px;
  min-height: 28px;
}

.correxit-assignment-overwrite input {
  flex: 0 0 auto;
  margin: 0;
}

.correxit-assignment-propagate .jp-ToolbarButtonComponent {
  justify-content: flex-start;
  margin: 0;
  min-width: 0;
  text-align: left;
  width: 100%;
}

.correxit-sidebar-inner-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin: 6px var(--correxit-sidebar-content-inset);
}

.correxit-sidebar-phase,
.correxit-sidebar-next {
  background-color: var(--jp-layout-color2);
  border: 1px solid var(--jp-border-color2);
  border-radius: 3px;
  margin: 0 var(--correxit-sidebar-content-inset) 6px;
  padding: 8px 10px;
}

.correxit-sidebar-phase {
  border-left: 3px solid var(--jp-border-color2);

  &.cxt-mod-active {
    border-left-color: var(--jp-brand-color1);
  }

  &.cxt-mod-certified {
    border-left-color: var(--correxit-correct-color);
  }

  &.cxt-mod-collected {
    background-color: color-mix(
      in srgb,
      var(--correxit-correct-color) 10%,
      var(--jp-layout-color2)
    );
    border-left-color: var(--correxit-correct-color);
  }

  &.cxt-mod-issued {
    border-left-color: var(--correxit-insistent-color);
  }

  &.cxt-mod-locked {
    border-left-color: var(--jp-border-color3);
  }

  &.cxt-mod-submitted {
    border-left-color: var(--jp-warn-color1);
  }

  &.cxt-mod-template {
    border-left-color: var(--jp-brand-color2);
  }
}

.correxit-sidebar-phase-bar,
.correxit-sidebar-next-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.correxit-sidebar-phase-bar {
  align-items: flex-start;
}

.correxit-sidebar-phase-label,
.correxit-sidebar-next-label {
  color: var(--jp-ui-font-color2);
  font-size: var(--jp-ui-font-size0);
  font-weight: 600;
}

.correxit-sidebar-phase-chip {
  background-color: var(--jp-layout-color4);
  border: 1px solid var(--jp-border-color3);
  border-radius: 3px;
  color: var(--jp-ui-font-color1);
  display: inline-flex;
  font-size: var(--jp-ui-font-size0);
  line-height: 1.3;
  margin-top: 2px;
  padding: 2px 8px;
}

.correxit-sidebar-phase-copy,
.correxit-sidebar-next-body,
.correxit-sidebar-phase-tail {
  color: var(--jp-ui-font-color2);
  font-size: var(--correxit-sidebar-font-size);
  line-height: 1.35;
}

.correxit-sidebar-phase-copy,
.correxit-sidebar-next-body {
  margin-top: 6px;
}

.correxit-sidebar-phase-tail {
  color: var(--jp-ui-font-color3);
  margin-top: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.correxit-sidebar-next-actions {
  display: grid;
  gap: 4px;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  margin-top: 8px;

  .jp-ToolbarButtonComponent {
    margin: 0;
    min-width: 0;
    width: 100%;
  }
}

.correxit-sidebar p {
  background-color: var(--jp-layout-color4);
  border-radius: 3px;
  border-color: var(--jp-border-color4);
  border-width: 2px;
  color: var(--jp-ui-font-color4);
  font-size: var(--correxit-sidebar-font-size);
  margin: 10px var(--correxit-sidebar-content-inset) 0;
  padding: 8px;
}

.correxit-sidebar-header p {
  margin: 6px var(--correxit-sidebar-content-inset) 0;
}

.correxit-sidebar-additional-operations {
  display: flex;
  flex-flow: column;
  align-items: start;
  margin: 20px 0;
}

.correxit-assignment {
  background-color: var(--jp-layout-color2);
  border: 2px solid var(--jp-border-color2);
  border-radius: 3px;
  margin: 0 var(--correxit-sidebar-content-inset);
  padding: 4px 0;
}

.correxit-assignment-controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.correxit-assignment-facts {
  display: grid;
  gap: 4px;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  margin: 0 var(--correxit-sidebar-content-inset) 6px;
}

.correxit-assignment-fact {
  background-color: var(--jp-layout-color1);
  border: 1px solid var(--jp-border-color2);
  border-radius: 3px;
  min-width: 0;
  padding: 6px;
}

.correxit-assignment-fact-label {
  color: var(--jp-ui-font-color3);
  display: block;
  font-size: var(--jp-ui-font-size0);
}

.correxit-assignment-fact-value {
  color: var(--jp-ui-font-color1);
  display: block;
  font-size: var(--correxit-sidebar-font-size);
  line-height: 1.3;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.correxit-assignment.cxt-mod-pending {
  animation: correxit-pulse 1.5s ease-in-out infinite;
  min-height: 28px;
}

@keyframes correxit-pulse {
  0%,
  100% {
    opacity: 0.4;
  }

  50% {
    opacity: 1;
  }
}

.correxit-assignment-assignee,
.correxit-assignment-overdue,
.correxit-assignment-roster {
  display: flex;

  > div {
    flex: 1;
  }

  label {
    display: inline-block;
    padding: 4px 0;
  }

  select,
  textarea {
    min-height: 28px;
    width: var(--correxit-sidebar-control-width);
  }

  select {
    height: 28px;
    margin-top: 3px;
  }
}

.correxit-assignment-roster textarea {
  min-height: 112px;
  resize: vertical;
}

.correxit-assignment-hint {
  color: var(--jp-ui-font-color3);
  font-size: var(--jp-ui-font-size0);
  margin: 0 0 4px;
}

.correxit-assignment-list {
  background-color: var(--jp-layout-color1);
  border: 1px solid var(--jp-border-color2);
  border-radius: 3px;
  color: var(--jp-ui-font-color1);
  font-family: var(--jp-code-font-family);
  font-size: var(--correxit-sidebar-font-size);
  line-height: 1.4;
  margin-top: 3px;
  max-height: 120px;
  overflow: auto;
  padding: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}

.correxit-assignment-list.cxt-mod-empty {
  color: var(--jp-ui-font-color3);
  font-family: var(--jp-ui-font-family);
  white-space: normal;
}

.correxit-assignment-expiration.cxt-mod-expired {
  color: var(--jp-warn-color0);
}

.correxit-assignment-expiration {
  padding: 2px 0;

  label {
    display: inline-block;
    font-size: var(--jp-ui-font-size0);
    padding: 4px 0 2px;
  }

  input[type='datetime-local'] {
    font-size: var(--correxit-sidebar-font-size);
    height: 28px;
    width: var(--correxit-sidebar-control-width);
  }
}

.correxit-assignment-overdue {
  padding: 2px 0;

  label {
    display: inline-block;
    font-size: var(--jp-ui-font-size0);
    padding: 4px 0 2px;
  }

  input[type='number'],
  select {
    font-size: var(--correxit-sidebar-font-size);
    height: 28px;
    width: var(--correxit-sidebar-control-width);
  }

  input[type='number'] {
    margin-top: 3px;
  }
}

.correxit-sidebar-cell-score-edit {
  background-color: var(--jp-layout-color2);
  border: 1px solid var(--jp-border-color2);
  border-radius: 3px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 var(--correxit-sidebar-content-inset) 10px;
  padding: 8px 10px;
}

.correxit-sidebar-cell-score-field {
  color: var(--jp-ui-font-color2);
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0;
}

.correxit-sidebar-cell-score-input {
  font-size: var(--correxit-sidebar-font-size);
  min-height: 24px;
  text-align: right;
  width: 72px;
}

.correxit-sidebar-cell-score-comment {
  color: var(--jp-ui-font-color2);
  font-size: var(--correxit-sidebar-font-size);
  margin-top: 2px;
}

.correxit-sidebar-cell-score-comment > summary {
  cursor: pointer;
  user-select: none;
}

.correxit-sidebar-cell-score-textarea {
  font-size: var(--correxit-sidebar-font-size);
  margin-top: 4px;
  resize: vertical;
  width: 100%;
}

.correxit-sidebar-cell-score-guide {
  color: var(--jp-ui-font-color3);
  font-size: var(--jp-ui-font-size0);
  line-height: 1.3;
  margin: 0;
}

.correxit-sidebar-references {
  margin: 8px var(--correxit-sidebar-content-inset) 0;
}

.correxit-sidebar-references h5 {
  margin-bottom: 4px;
}

.correxit-sidebar-references .jp-ToolbarButtonComponent {
  margin: 4px 0 0;
  min-width: 0;
  width: 100%;
}

.correxit-sidebar-references-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.correxit-sidebar-reference-item {
  align-items: center;
  background-color: var(--jp-layout-color2);
  border: 1px solid var(--jp-border-color2);
  border-radius: 3px;
  display: flex;
  gap: 4px;
  margin-bottom: 2px;
  padding: 2px 4px;
}

.correxit-sidebar-reference-locate {
  background: none;
  border: none;
  color: var(--jp-content-link-color);
  cursor: pointer;
  flex: 0 0 auto;
  font-family: var(--jp-code-font-family);
  font-size: var(--jp-ui-font-size0);
  padding: 2px 0;
  text-align: left;
  text-decoration: underline;
}

.correxit-sidebar-reference-locate:hover {
  opacity: 0.8;
}

.correxit-sidebar-reference-source {
  color: var(--jp-ui-font-color2);
  flex: 1;
  font-family: var(--jp-code-font-family);
  font-size: var(--jp-ui-font-size0);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.correxit-sidebar-reference-points {
  color: var(--jp-ui-font-color3);
  flex: 0 0 auto;
  font-size: var(--jp-ui-font-size0);
  white-space: nowrap;
}

.correxit-sidebar-reference-item .jp-ToolbarButtonComponent {
  align-items: center;
  display: flex;
  flex-shrink: 0;
  justify-content: center;
  min-height: 24px;
  padding: 0;
  width: 24px;
}

.correxit-sidebar-footer {
  margin-top: 6px;
}

.correxit-sidebar-footer .jp-ToolbarButtonComponent {
  background-color: var(--jp-layout-color2);
  border: 1px solid var(--jp-warn-color2);
  margin: 0;
  min-width: 0;
  width: 100%;
}

.correxit-sidebar-footer .jp-ToolbarButtonComponent:hover {
  background-color: var(--jp-layout-color3);
  border-color: var(--jp-warn-color1);
}

.correxit-sidebar-footer .jp-ToolbarButtonComponent > span {
  color: var(--jp-warn-color0);
}

button.jp-Dialog-button.correxit-dialog-revert.jp-mod-styled.jp-mod-accept {
  background-color: var(--jp-layout-color2);
  border: 1px solid var(--jp-warn-color2);
  color: var(--jp-warn-color0);
}

button.jp-Dialog-button.correxit-dialog-revert.jp-mod-styled.jp-mod-accept:hover {
  background-color: var(--jp-layout-color3);
  border-color: var(--jp-warn-color1);
}

button.jp-Dialog-button.correxit-dialog-revert.jp-mod-styled.jp-mod-accept:active {
  background-color: var(--jp-layout-color3);
  border-color: var(--jp-warn-color0);
}

button.jp-Dialog-button.correxit-dialog-revert.jp-mod-styled.jp-mod-accept:focus,
button.jp-Dialog-button.correxit-dialog-revert.jp-mod-styled.jp-mod-accept:focus-visible {
  outline: 1px solid var(--jp-warn-color1);
}

.correxit-sidebar-inner-header .jp-ToolbarButtonComponent:hover {
  background-color: transparent;
}
`, "",{"version":3,"sources":["webpack://./style/ui/sidebar.css"],"names":[],"mappings":"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","sourcesContent":["#correxit-sidebar.correxit-sidebar {\n  min-width: 285px;\n}\n\n.correxit-sidebar {\n  --correxit-sidebar-content-inset: 2px;\n  --correxit-sidebar-control-width: 100%;\n  --correxit-sidebar-font-size: var(--jp-ui-font-size1);\n  --correxit-sidebar-section-padding: 6px;\n\n  display: flex;\n  flex-flow: column;\n  min-height: 0;\n  overflow: hidden auto;\n}\n\n.correxit-sidebar input,\n.correxit-sidebar select,\n.correxit-sidebar textarea {\n  box-sizing: border-box;\n  max-width: 100%;\n}\n\n.correxit-sidebar h4 {\n  font-size: var(--correxit-sidebar-font-size);\n  font-weight: 600;\n}\n\n.correxit-sidebar h5 {\n  font-size: var(--correxit-sidebar-font-size);\n  margin: 0;\n  font-weight: 300 !important;\n}\n\n.correxit-sidebar > section {\n  padding: var(--correxit-sidebar-section-padding);\n}\n\n.correxit-sidebar > section.correxit-sidebar-body {\n  flex: 1;\n}\n\n.correxit-sidebar-body > textarea {\n  background-color: var(--jp-layout-color2);\n  color: var(--jp-ui-font-color2);\n  display: block;\n  font-size: var(--correxit-sidebar-font-size);\n  height: 35px;\n  margin: 0 var(--correxit-sidebar-content-inset) 10px;\n  overflow-y: auto;\n  width: calc(100% - (2 * var(--correxit-sidebar-content-inset)));\n}\n\n.correxit-sidebar .correxit-monospace {\n  background-color: var(--jp-layout-color2);\n  font-family: var(--jp-code-font-family);\n  font-size: var(--correxit-sidebar-font-size);\n  margin: 2px 0;\n  overflow: hidden;\n  padding: 5px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.correxit-sidebar-cell-report {\n  align-items: center;\n  display: flex;\n  flex-direction: row;\n  justify-content: space-between;\n  margin: 6px var(--correxit-sidebar-content-inset) 8px;\n}\n\n.correxit-sidebar-cell-config {\n  color: var(--jp-ui-font-color3);\n  display: flex;\n  gap: 4px;\n  text-align: center;\n}\n\n.correxit-sidebar-cell-config .jp-ToolbarButtonComponent {\n  flex: 1;\n  margin: 0;\n  min-width: 0;\n}\n\n.correxit-sidebar-cell-actions .jp-ToolbarButtonComponent {\n  margin: 0;\n  min-width: 0;\n  width: 100%;\n}\n\n.correxit-sidebar-cell-actions {\n  display: grid;\n  gap: 4px;\n  grid-template-columns: 1fr 1fr;\n}\n\n.correxit-sidebar-cell-pair {\n  display: grid;\n  gap: 4px;\n  grid-template-columns: repeat(auto-fit, minmax(calc(50% - 2px), 1fr));\n}\n\n.correxit-sidebar-cell-pair .jp-ToolbarButtonComponent {\n  margin: 0;\n  min-width: 0;\n  width: 100%;\n}\n\n.correxit-assignment-chip {\n  background-color: var(--jp-layout-color4);\n  border: 1px solid var(--jp-border-color3);\n  border-radius: 3px;\n  color: var(--jp-ui-font-color2);\n  display: block;\n  font-size: var(--jp-ui-font-size0);\n  margin: 2px var(--correxit-sidebar-content-inset);\n  overflow: hidden;\n  padding: 4px 6px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.correxit-sidebar .jp-ToolbarButtonComponent > span {\n  color: var(--jp-inverse-layout-color);\n  font-size: var(--correxit-sidebar-font-size);\n}\n\n.correxit-sidebar .jp-ToolbarButtonComponent svg {\n  margin-right: 5px;\n}\n\n.correxit-sidebar .jp-ToolbarButtonComponent.lm-mod-hidden {\n  display: none;\n}\n\n.correxit-assignment-propagate {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  margin: 4px var(--correxit-sidebar-content-inset) 0;\n}\n\n.correxit-assignment-overwrite {\n  align-items: center;\n  display: flex;\n  gap: 6px;\n  min-height: 28px;\n}\n\n.correxit-assignment-overwrite input {\n  flex: 0 0 auto;\n  margin: 0;\n}\n\n.correxit-assignment-propagate .jp-ToolbarButtonComponent {\n  justify-content: flex-start;\n  margin: 0;\n  min-width: 0;\n  text-align: left;\n  width: 100%;\n}\n\n.correxit-sidebar-inner-header {\n  align-items: center;\n  display: flex;\n  justify-content: space-between;\n  margin: 6px var(--correxit-sidebar-content-inset);\n}\n\n.correxit-sidebar-phase,\n.correxit-sidebar-next {\n  background-color: var(--jp-layout-color2);\n  border: 1px solid var(--jp-border-color2);\n  border-radius: 3px;\n  margin: 0 var(--correxit-sidebar-content-inset) 6px;\n  padding: 8px 10px;\n}\n\n.correxit-sidebar-phase {\n  border-left: 3px solid var(--jp-border-color2);\n\n  &.cxt-mod-active {\n    border-left-color: var(--jp-brand-color1);\n  }\n\n  &.cxt-mod-certified {\n    border-left-color: var(--correxit-correct-color);\n  }\n\n  &.cxt-mod-collected {\n    background-color: color-mix(\n      in srgb,\n      var(--correxit-correct-color) 10%,\n      var(--jp-layout-color2)\n    );\n    border-left-color: var(--correxit-correct-color);\n  }\n\n  &.cxt-mod-issued {\n    border-left-color: var(--correxit-insistent-color);\n  }\n\n  &.cxt-mod-locked {\n    border-left-color: var(--jp-border-color3);\n  }\n\n  &.cxt-mod-submitted {\n    border-left-color: var(--jp-warn-color1);\n  }\n\n  &.cxt-mod-template {\n    border-left-color: var(--jp-brand-color2);\n  }\n}\n\n.correxit-sidebar-phase-bar,\n.correxit-sidebar-next-copy {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.correxit-sidebar-phase-bar {\n  align-items: flex-start;\n}\n\n.correxit-sidebar-phase-label,\n.correxit-sidebar-next-label {\n  color: var(--jp-ui-font-color2);\n  font-size: var(--jp-ui-font-size0);\n  font-weight: 600;\n}\n\n.correxit-sidebar-phase-chip {\n  background-color: var(--jp-layout-color4);\n  border: 1px solid var(--jp-border-color3);\n  border-radius: 3px;\n  color: var(--jp-ui-font-color1);\n  display: inline-flex;\n  font-size: var(--jp-ui-font-size0);\n  line-height: 1.3;\n  margin-top: 2px;\n  padding: 2px 8px;\n}\n\n.correxit-sidebar-phase-copy,\n.correxit-sidebar-next-body,\n.correxit-sidebar-phase-tail {\n  color: var(--jp-ui-font-color2);\n  font-size: var(--correxit-sidebar-font-size);\n  line-height: 1.35;\n}\n\n.correxit-sidebar-phase-copy,\n.correxit-sidebar-next-body {\n  margin-top: 6px;\n}\n\n.correxit-sidebar-phase-tail {\n  color: var(--jp-ui-font-color3);\n  margin-top: 6px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.correxit-sidebar-next-actions {\n  display: grid;\n  gap: 4px;\n  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));\n  margin-top: 8px;\n\n  .jp-ToolbarButtonComponent {\n    margin: 0;\n    min-width: 0;\n    width: 100%;\n  }\n}\n\n.correxit-sidebar p {\n  background-color: var(--jp-layout-color4);\n  border-radius: 3px;\n  border-color: var(--jp-border-color4);\n  border-width: 2px;\n  color: var(--jp-ui-font-color4);\n  font-size: var(--correxit-sidebar-font-size);\n  margin: 10px var(--correxit-sidebar-content-inset) 0;\n  padding: 8px;\n}\n\n.correxit-sidebar-header p {\n  margin: 6px var(--correxit-sidebar-content-inset) 0;\n}\n\n.correxit-sidebar-additional-operations {\n  display: flex;\n  flex-flow: column;\n  align-items: start;\n  margin: 20px 0;\n}\n\n.correxit-assignment {\n  background-color: var(--jp-layout-color2);\n  border: 2px solid var(--jp-border-color2);\n  border-radius: 3px;\n  margin: 0 var(--correxit-sidebar-content-inset);\n  padding: 4px 0;\n}\n\n.correxit-assignment-controls {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.correxit-assignment-facts {\n  display: grid;\n  gap: 4px;\n  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));\n  margin: 0 var(--correxit-sidebar-content-inset) 6px;\n}\n\n.correxit-assignment-fact {\n  background-color: var(--jp-layout-color1);\n  border: 1px solid var(--jp-border-color2);\n  border-radius: 3px;\n  min-width: 0;\n  padding: 6px;\n}\n\n.correxit-assignment-fact-label {\n  color: var(--jp-ui-font-color3);\n  display: block;\n  font-size: var(--jp-ui-font-size0);\n}\n\n.correxit-assignment-fact-value {\n  color: var(--jp-ui-font-color1);\n  display: block;\n  font-size: var(--correxit-sidebar-font-size);\n  line-height: 1.3;\n  margin-top: 2px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.correxit-assignment.cxt-mod-pending {\n  animation: correxit-pulse 1.5s ease-in-out infinite;\n  min-height: 28px;\n}\n\n@keyframes correxit-pulse {\n  0%,\n  100% {\n    opacity: 0.4;\n  }\n\n  50% {\n    opacity: 1;\n  }\n}\n\n.correxit-assignment-assignee,\n.correxit-assignment-overdue,\n.correxit-assignment-roster {\n  display: flex;\n\n  > div {\n    flex: 1;\n  }\n\n  label {\n    display: inline-block;\n    padding: 4px 0;\n  }\n\n  select,\n  textarea {\n    min-height: 28px;\n    width: var(--correxit-sidebar-control-width);\n  }\n\n  select {\n    height: 28px;\n    margin-top: 3px;\n  }\n}\n\n.correxit-assignment-roster textarea {\n  min-height: 112px;\n  resize: vertical;\n}\n\n.correxit-assignment-hint {\n  color: var(--jp-ui-font-color3);\n  font-size: var(--jp-ui-font-size0);\n  margin: 0 0 4px;\n}\n\n.correxit-assignment-list {\n  background-color: var(--jp-layout-color1);\n  border: 1px solid var(--jp-border-color2);\n  border-radius: 3px;\n  color: var(--jp-ui-font-color1);\n  font-family: var(--jp-code-font-family);\n  font-size: var(--correxit-sidebar-font-size);\n  line-height: 1.4;\n  margin-top: 3px;\n  max-height: 120px;\n  overflow: auto;\n  padding: 6px;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n.correxit-assignment-list.cxt-mod-empty {\n  color: var(--jp-ui-font-color3);\n  font-family: var(--jp-ui-font-family);\n  white-space: normal;\n}\n\n.correxit-assignment-expiration.cxt-mod-expired {\n  color: var(--jp-warn-color0);\n}\n\n.correxit-assignment-expiration {\n  padding: 2px 0;\n\n  label {\n    display: inline-block;\n    font-size: var(--jp-ui-font-size0);\n    padding: 4px 0 2px;\n  }\n\n  input[type='datetime-local'] {\n    font-size: var(--correxit-sidebar-font-size);\n    height: 28px;\n    width: var(--correxit-sidebar-control-width);\n  }\n}\n\n.correxit-assignment-overdue {\n  padding: 2px 0;\n\n  label {\n    display: inline-block;\n    font-size: var(--jp-ui-font-size0);\n    padding: 4px 0 2px;\n  }\n\n  input[type='number'],\n  select {\n    font-size: var(--correxit-sidebar-font-size);\n    height: 28px;\n    width: var(--correxit-sidebar-control-width);\n  }\n\n  input[type='number'] {\n    margin-top: 3px;\n  }\n}\n\n.correxit-sidebar-cell-score-edit {\n  background-color: var(--jp-layout-color2);\n  border: 1px solid var(--jp-border-color2);\n  border-radius: 3px;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  margin: 0 var(--correxit-sidebar-content-inset) 10px;\n  padding: 8px 10px;\n}\n\n.correxit-sidebar-cell-score-field {\n  color: var(--jp-ui-font-color2);\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  margin: 0;\n}\n\n.correxit-sidebar-cell-score-input {\n  font-size: var(--correxit-sidebar-font-size);\n  min-height: 24px;\n  text-align: right;\n  width: 72px;\n}\n\n.correxit-sidebar-cell-score-comment {\n  color: var(--jp-ui-font-color2);\n  font-size: var(--correxit-sidebar-font-size);\n  margin-top: 2px;\n}\n\n.correxit-sidebar-cell-score-comment > summary {\n  cursor: pointer;\n  user-select: none;\n}\n\n.correxit-sidebar-cell-score-textarea {\n  font-size: var(--correxit-sidebar-font-size);\n  margin-top: 4px;\n  resize: vertical;\n  width: 100%;\n}\n\n.correxit-sidebar-cell-score-guide {\n  color: var(--jp-ui-font-color3);\n  font-size: var(--jp-ui-font-size0);\n  line-height: 1.3;\n  margin: 0;\n}\n\n.correxit-sidebar-references {\n  margin: 8px var(--correxit-sidebar-content-inset) 0;\n}\n\n.correxit-sidebar-references h5 {\n  margin-bottom: 4px;\n}\n\n.correxit-sidebar-references .jp-ToolbarButtonComponent {\n  margin: 4px 0 0;\n  min-width: 0;\n  width: 100%;\n}\n\n.correxit-sidebar-references-list {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n}\n\n.correxit-sidebar-reference-item {\n  align-items: center;\n  background-color: var(--jp-layout-color2);\n  border: 1px solid var(--jp-border-color2);\n  border-radius: 3px;\n  display: flex;\n  gap: 4px;\n  margin-bottom: 2px;\n  padding: 2px 4px;\n}\n\n.correxit-sidebar-reference-locate {\n  background: none;\n  border: none;\n  color: var(--jp-content-link-color);\n  cursor: pointer;\n  flex: 0 0 auto;\n  font-family: var(--jp-code-font-family);\n  font-size: var(--jp-ui-font-size0);\n  padding: 2px 0;\n  text-align: left;\n  text-decoration: underline;\n}\n\n.correxit-sidebar-reference-locate:hover {\n  opacity: 0.8;\n}\n\n.correxit-sidebar-reference-source {\n  color: var(--jp-ui-font-color2);\n  flex: 1;\n  font-family: var(--jp-code-font-family);\n  font-size: var(--jp-ui-font-size0);\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.correxit-sidebar-reference-points {\n  color: var(--jp-ui-font-color3);\n  flex: 0 0 auto;\n  font-size: var(--jp-ui-font-size0);\n  white-space: nowrap;\n}\n\n.correxit-sidebar-reference-item .jp-ToolbarButtonComponent {\n  align-items: center;\n  display: flex;\n  flex-shrink: 0;\n  justify-content: center;\n  min-height: 24px;\n  padding: 0;\n  width: 24px;\n}\n\n.correxit-sidebar-footer {\n  margin-top: 6px;\n}\n\n.correxit-sidebar-footer .jp-ToolbarButtonComponent {\n  background-color: var(--jp-layout-color2);\n  border: 1px solid var(--jp-warn-color2);\n  margin: 0;\n  min-width: 0;\n  width: 100%;\n}\n\n.correxit-sidebar-footer .jp-ToolbarButtonComponent:hover {\n  background-color: var(--jp-layout-color3);\n  border-color: var(--jp-warn-color1);\n}\n\n.correxit-sidebar-footer .jp-ToolbarButtonComponent > span {\n  color: var(--jp-warn-color0);\n}\n\nbutton.jp-Dialog-button.correxit-dialog-revert.jp-mod-styled.jp-mod-accept {\n  background-color: var(--jp-layout-color2);\n  border: 1px solid var(--jp-warn-color2);\n  color: var(--jp-warn-color0);\n}\n\nbutton.jp-Dialog-button.correxit-dialog-revert.jp-mod-styled.jp-mod-accept:hover {\n  background-color: var(--jp-layout-color3);\n  border-color: var(--jp-warn-color1);\n}\n\nbutton.jp-Dialog-button.correxit-dialog-revert.jp-mod-styled.jp-mod-accept:active {\n  background-color: var(--jp-layout-color3);\n  border-color: var(--jp-warn-color0);\n}\n\nbutton.jp-Dialog-button.correxit-dialog-revert.jp-mod-styled.jp-mod-accept:focus,\nbutton.jp-Dialog-button.correxit-dialog-revert.jp-mod-styled.jp-mod-accept:focus-visible {\n  outline: 1px solid var(--jp-warn-color1);\n}\n\n.correxit-sidebar-inner-header .jp-ToolbarButtonComponent:hover {\n  background-color: transparent;\n}\n"],"sourceRoot":""}]);
// Exports
/* export default */ const __rspack_default_export = (___CSS_LOADER_EXPORT___);


},
"./node_modules/css-loader/dist/cjs.js!./style/ui/toolbars.css"(module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  "default": () => (__rspack_default_export)
});
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0 = __webpack_require__("./node_modules/css-loader/dist/runtime/sourceMaps.js");
/* import */ var _node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0);
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1 = __webpack_require__("./node_modules/css-loader/dist/runtime/api.js");
/* import */ var _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__rspack_import_1);
// Imports


var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__rspack_import_1_default()((_node_modules_css_loader_dist_runtime_sourceMaps_js__rspack_import_0_default()));
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.correxit-configure {
  background-color: var(--jp-inverse-layout-color3);
  border: 1px groove var(--jp-layout-color3);
  border-radius: 0;
  text-align: center;

  &:hover {
    background-color: var(--correxit-insistent-color);
  }

  &.lm-mod-toggled {
    background-color: var(--correxit-insistent-color);
    box-shadow: none;
  }
}
`, "",{"version":3,"sources":["webpack://./style/ui/toolbars.css"],"names":[],"mappings":"AAAA;EACE,iDAAiD;EACjD,0CAA0C;EAC1C,gBAAgB;EAChB,kBAAkB;;EAElB;IACE,iDAAiD;EACnD;;EAEA;IACE,iDAAiD;IACjD,gBAAgB;EAClB;AACF","sourcesContent":[".correxit-configure {\n  background-color: var(--jp-inverse-layout-color3);\n  border: 1px groove var(--jp-layout-color3);\n  border-radius: 0;\n  text-align: center;\n\n  &:hover {\n    background-color: var(--correxit-insistent-color);\n  }\n\n  &.lm-mod-toggled {\n    background-color: var(--correxit-insistent-color);\n    box-shadow: none;\n  }\n}\n"],"sourceRoot":""}]);
// Exports
/* export default */ const __rspack_default_export = (___CSS_LOADER_EXPORT___);


},
"./style/index.css"(__unused_rspack_module, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
  "default": () => (__rspack_default_export)
});
/* import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__rspack_import_0 = __webpack_require__("./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js");
/* import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__rspack_import_0_default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__rspack_import_0);
/* import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__rspack_import_1 = __webpack_require__("./node_modules/style-loader/dist/runtime/styleDomAPI.js");
/* import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__rspack_import_1_default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleDomAPI_js__rspack_import_1);
/* import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__rspack_import_2 = __webpack_require__("./node_modules/style-loader/dist/runtime/insertBySelector.js");
/* import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__rspack_import_2_default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertBySelector_js__rspack_import_2);
/* import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__rspack_import_3 = __webpack_require__("./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js");
/* import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__rspack_import_3_default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__rspack_import_3);
/* import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__rspack_import_4 = __webpack_require__("./node_modules/style-loader/dist/runtime/insertStyleElement.js");
/* import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__rspack_import_4_default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertStyleElement_js__rspack_import_4);
/* import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__rspack_import_5 = __webpack_require__("./node_modules/style-loader/dist/runtime/styleTagTransform.js");
/* import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__rspack_import_5_default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleTagTransform_js__rspack_import_5);
/* import */ var _node_modules_css_loader_dist_cjs_js_index_css__rspack_import_6 = __webpack_require__("./node_modules/css-loader/dist/cjs.js!./style/index.css");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__rspack_import_5_default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__rspack_import_3_default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__rspack_import_2_default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__rspack_import_1_default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__rspack_import_4_default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__rspack_import_0_default()(_node_modules_css_loader_dist_cjs_js_index_css__rspack_import_6["default"], options);




       /* export default */ const __rspack_default_export = (_node_modules_css_loader_dist_cjs_js_index_css__rspack_import_6["default"] && _node_modules_css_loader_dist_cjs_js_index_css__rspack_import_6["default"].locals ? _node_modules_css_loader_dist_cjs_js_index_css__rspack_import_6["default"].locals : undefined);


},
"./style/monitor/icons/answerable.svg?f361"(module) {
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzY1XzIxNDMpIj4KPHBhdGggZD0iTTEzLjk5OTcgMy45OTk5OUgxMi42NjYzVjkuOTk5OTlIMy45OTk2N1YxMS4zMzMzQzMuOTk5NjcgMTEuNyA0LjI5OTY3IDEyIDQuNjY2MzQgMTJIMTEuOTk5N0wxNC42NjYzIDE0LjY2NjdWNC42NjY2NkMxNC42NjYzIDQuMjk5OTkgMTQuMzY2MyAzLjk5OTk5IDEzLjk5OTcgMy45OTk5OVpNMTEuMzMzIDcuOTk5OTlWMS45OTk5OUMxMS4zMzMgMS42MzMzMyAxMS4wMzMgMS4zMzMzMyAxMC42NjYzIDEuMzMzMzNIMS45OTk2N0MxLjYzMzAxIDEuMzMzMzMgMS4zMzMwMSAxLjYzMzMzIDEuMzMzMDEgMS45OTk5OVYxMS4zMzMzTDMuOTk5NjcgOC42NjY2NkgxMC42NjYzQzExLjAzMyA4LjY2NjY2IDExLjMzMyA4LjM2NjY2IDExLjMzMyA3Ljk5OTk5WiIgZmlsbD0id2hpdGUiLz4KPC9nPgo8ZGVmcz4KPGNsaXBQYXRoIGlkPSJjbGlwMF82NV8yMTQzIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJ3aGl0ZSIvPgo8L2NsaXBQYXRoPgo8L2RlZnM+Cjwvc3ZnPgo=";

},
"./style/monitor/icons/comparable.svg?3cf5"(module) {
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEwLjE5OTcgOC44NjY2N0w3Ljc5OTY3IDYuNDY2NjdDNy43MzMwMSA2LjQgNy42ODU5IDYuMzI3NzggNy42NTgzNCA2LjI1QzcuNjMwMzQgNi4xNzIyMiA3LjYxNjM0IDYuMDg4ODkgNy42MTYzNCA2QzcuNjE2MzQgNS45MTExMSA3LjYzMDM0IDUuODI3NzggNy42NTgzNCA1Ljc1QzcuNjg1OSA1LjY3MjIyIDcuNzMzMDEgNS42IDcuNzk5NjcgNS41MzMzM0wxMC4xOTk3IDMuMTMzMzNDMTAuMzMzIDMgMTAuNDg4NiAyLjkzMzMzIDEwLjY2NjMgMi45MzMzM0MxMC44NDQxIDIuOTMzMzMgMTAuOTk5NyAzIDExLjEzMyAzLjEzMzMzQzExLjI2NjMgMy4yNjY2NyAxMS4zMzMgMy40MjQ4OSAxMS4zMzMgMy42MDhDMTEuMzMzIDMuNzkxNTYgMTEuMjY2MyAzLjk1IDExLjEzMyA0LjA4MzMzTDkuODgzMDEgNS4zMzMzM0gxMy45OTk3QzE0LjE4ODYgNS4zMzMzMyAxNC4zNDY4IDUuMzk3MTEgMTQuNDc0MyA1LjUyNDY3QzE0LjYwMjMgNS42NTI2NyAxNC42NjYzIDUuODExMTEgMTQuNjY2MyA2QzE0LjY2NjMgNi4xODg4OSAxNC42MDIzIDYuMzQ3MTEgMTQuNDc0MyA2LjQ3NDY3QzE0LjM0NjggNi42MDI2NyAxNC4xODg2IDYuNjY2NjcgMTMuOTk5NyA2LjY2NjY3SDkuODgzMDFMMTEuMTMzIDcuOTE2NjdDMTEuMjY2MyA4LjA1IDExLjMzMyA4LjIwNTU2IDExLjMzMyA4LjM4MzMzQzExLjMzMyA4LjU2MTExIDExLjI2NjMgOC43MTY2NyAxMS4xMzMgOC44NUMxMC45OTk3IDguOTgzMzMgMTAuODQ3IDkuMDU1NTYgMTAuNjc1IDkuMDY2NjdDMTAuNTAyNiA5LjA3Nzc4IDEwLjM0NDEgOS4wMTExMSAxMC4xOTk3IDguODY2NjdaTTQuODY2MzQgMTIuODVDNC45OTk2NyAxMi45ODMzIDUuMTU1MjMgMTMuMDUyNyA1LjMzMzAxIDEzLjA1OEM1LjUxMDc5IDEzLjA2MzggNS42NjYzNCAxMyA1Ljc5OTY3IDEyLjg2NjdMOC4xOTk2NyAxMC40NjY3QzguMjY2MzQgMTAuNCA4LjMxMzY3IDEwLjMyNzggOC4zNDE2NyAxMC4yNUM4LjM2OTIzIDEwLjE3MjIgOC4zODMwMSAxMC4wODg5IDguMzgzMDEgMTBDOC4zODMwMSA5LjkxMTExIDguMzY5MjMgOS44Mjc3OCA4LjM0MTY3IDkuNzVDOC4zMTM2NyA5LjY3MjIyIDguMjY2MzQgOS42IDguMTk5NjcgOS41MzMzM0w1Ljc5OTY3IDcuMTMzMzNDNS42NjYzNCA3IDUuNTEwNzkgNi45MzMzMyA1LjMzMzAxIDYuOTMzMzNDNS4xNTUyMyA2LjkzMzMzIDQuOTk5NjcgNyA0Ljg2NjM0IDcuMTMzMzNDNC43MzMwMSA3LjI2NjY3IDQuNjY2MzQgNy40MjQ4OSA0LjY2NjM0IDcuNjA4QzQuNjY2MzQgNy43OTE1NiA0LjczMzAxIDcuOTUgNC44NjYzNCA4LjA4MzMzTDYuMTE2MzQgOS4zMzMzM0gxLjk5OTY3QzEuODEwNzkgOS4zMzMzMyAxLjY1MjU2IDkuMzk3MTEgMS41MjUwMSA5LjUyNDY3QzEuMzk3MDEgOS42NTI2NyAxLjMzMzAxIDkuODExMTEgMS4zMzMwMSAxMEMxLjMzMzAxIDEwLjE4ODkgMS4zOTcwMSAxMC4zNDcxIDEuNTI1MDEgMTAuNDc0N0MxLjY1MjU2IDEwLjYwMjcgMS44MTA3OSAxMC42NjY3IDEuOTk5NjcgMTAuNjY2N0g2LjExNjM0TDQuODY2MzQgMTEuOTE2N0M0LjczMzAxIDEyLjA1IDQuNjY2MzQgMTIuMjA1NiA0LjY2NjM0IDEyLjM4MzNDNC42NjYzNCAxMi41NjExIDQuNzMzMDEgMTIuNzE2NyA0Ljg2NjM0IDEyLjg1WiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+Cg==";

},
"./style/monitor/icons/correctable.svg?75e6"(module) {
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTcuOTk5NjcgMS4zMzMzNEM0LjMxNzY3IDEuMzMzMzQgMS4zMzMwMSA0LjMxOCAxLjMzMzAxIDhDMS4zMzMwMSAxMS42ODIgNC4zMTc2NyAxNC42NjY3IDcuOTk5NjcgMTQuNjY2N0MxMS42ODE3IDE0LjY2NjcgMTQuNjY2MyAxMS42ODIgMTQuNjY2MyA4QzE0LjY2NjMgNC4zMTggMTEuNjgxNyAxLjMzMzM0IDcuOTk5NjcgMS4zMzMzNFpNNi42NjYzNCAxMS42MDkzTDMuNTI4MzQgOC40NzEzNEw0LjQ3MTAxIDcuNTI4NjdMNi42NjYzNCA5LjcyNEwxMS41MjgzIDQuODYyTDEyLjQ3MSA1LjgwNDY3TDYuNjY2MzQgMTEuNjA5M1oiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=";

},
"./style/monitor/icons/locked.svg?bc25"(module) {
module.exports = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzY1XzI5MjMpIj4KPHBhdGggZD0iTTEyIDE3QzEzLjEgMTcgMTQgMTYuMSAxNCAxNUMxNCAxMy45IDEzLjEgMTMgMTIgMTNDMTAuOSAxMyAxMCAxMy45IDEwIDE1QzEwIDE2LjEgMTAuOSAxNyAxMiAxN1pNMTggOEgxN1Y2QzE3IDMuMjQgMTQuNzYgMSAxMiAxQzkuMjQgMSA3IDMuMjQgNyA2VjhINkM0LjkgOCA0IDguOSA0IDEwVjIwQzQgMjEuMSA0LjkgMjIgNiAyMkgxOEMxOS4xIDIyIDIwIDIxLjEgMjAgMjBWMTBDMjAgOC45IDE5LjEgOCAxOCA4Wk04LjkgNkM4LjkgNC4yOSAxMC4yOSAyLjkgMTIgMi45QzEzLjcxIDIuOSAxNS4xIDQuMjkgMTUuMSA2VjhIOC45VjZaTTE4IDIwSDZWMTBIMThWMjBaIiBmaWxsPSJjdXJyZW50Q29sb3IiLz4KPC9nPgo8ZGVmcz4KPGNsaXBQYXRoIGlkPSJjbGlwMF82NV8yOTIzIj4KPHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSJjdXJyZW50Q29sb3IiLz4KPC9jbGlwUGF0aD4KPC9kZWZzPgo8L3N2Zz4K";

},
"./style/monitor/icons/reviewable.svg?8c06"(module) {
module.exports = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMTZweCIgdmlld0JveD0iMCAtOTYwIDk2MCA5NjAiIHdpZHRoPSIxNnB4IiBmaWxsPSJub25lIj4KPHBhdGggZD0iTTI0MC00MDBoMTIybDIwMC0yMDBxOS05IDEzLjUtMjAuNVQ1ODAtNjQzcTAtMTEtNS0yMS41VDU2Mi02ODRsLTM2LTM4cS05LTktMjAtMTMuNXQtMjMtNC41cS0xMSAwLTIyLjUgNC41VDQ0MC03MjJMMjQwLTUyMnYxMjJabTI4MC0yNDMtMzctMzcgMzcgMzdaTTMwMC00NjB2LTM4bDEwMS0xMDEgMjAgMTggMTggMjAtMTAxIDEwMWgtMzhabTEyMS0xMjEgMTggMjAtMzgtMzggMjAgMThabTI2IDE4MWgyNzN2LTgwSDUyN2wtODAgODBaTTgwLTgwdi03MjBxMC0zMyAyMy41LTU2LjVUMTYwLTg4MGg2NDBxMzMgMCA1Ni41IDIzLjVUODgwLTgwMHY0ODBxMCAzMy0yMy41IDU2LjVUODAwLTI0MEgyNDBMODAtODBabTEyNi0yNDBoNTk0di00ODBIMTYwdjUyNWw0Ni00NVptLTQ2IDB2LTQ4MCA0ODBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K";

},

}]);
//# sourceMappingURL=style_index_js.8bbc41378e248aad.js.map