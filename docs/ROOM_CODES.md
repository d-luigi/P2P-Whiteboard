# Short room codes

The toolbar and phone menu display a six-character room code. Copy it and enter it
in Join board on another device. Codes are case-insensitive. Password-protected
boards still prompt for the password, which is never stored in the code directory.

Deploy the updated `signaling/` service and frontend together. All clients must use
the same first URL in `VITE_SIGNALING`, which hosts the room-code directory.
An older signaling server will report that room codes are unavailable.

Codes expire 24 hours after their last registration. Open boards refresh their
registration every 30 seconds. The directory lives in server memory, so a server
restart changes codes; hosts should copy the currently displayed code again.
Run a single signaling instance for this directory. Multiple replicas would need
a shared directory before short codes can be used across them.

The directory stores board IDs and their password/view flags, but no drawings or
passwords. This means the signaling operator can see the board IDs registered for
short-code joining. Six-character codes can also be guessed more easily than full
board links. Use a board password when access needs to be restricted.
