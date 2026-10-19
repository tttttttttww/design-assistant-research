// The original v11.53 W7 test assumed that W7 could select a message from any earlier
// class. The v11.54+ protocol explicitly reviews the *immediately previous* class.
// This compatibility entry point therefore runs the current W5–W10 weekly protocol
// test, which checks selection, human classification override and the case fallback.
import './weekly-intervention-test.mjs';
