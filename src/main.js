/**
 * @file main.js
 * @description Boot entry. Mounts the editor shell. Nothing else lives here.
 * Phase 0.
 */

import { bootShell } from './editor/shell.js';

bootShell(document.getElementById('app'));
