// doom-pane platform file for doomgeneric: the DG_* functions live in
// dg-library.js (an Emscripten JS library); this file only adds the small C
// getters the JS driver calls and declares the two callbacks the patches add.
#include "doomgeneric.h"

#include <emscripten/emscripten.h>

EMSCRIPTEN_KEEPALIVE pixel_t* DG_GetScreenBuffer(void) { return DG_ScreenBuffer; }
EMSCRIPTEN_KEEPALIVE int DG_GetScreenWidth(void) { return DOOMGENERIC_RESX; }
EMSCRIPTEN_KEEPALIVE int DG_GetScreenHeight(void) { return DOOMGENERIC_RESY; }

// Declared here, implemented in dg-library.js; called from the patched
// g_game.c (after a savegame is renamed into place) and i_system.c (I_Quit).
void DG_OnSaveGame(const char* path);
void DG_OnQuit(void);
