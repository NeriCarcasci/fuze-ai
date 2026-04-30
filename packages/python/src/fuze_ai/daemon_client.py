"""Stub client for the Fuze runtime daemon (Phase 3)."""
from __future__ import annotations


class DaemonClient:
    """Stub for the Phase 3 runtime daemon.

    Always returns 'proceed' in Phase 1/2. Prepares the IPC interface
    for Phase 3 daemon integration.

    Args:
        socket_path: Unix socket path for daemon communication. Default: '/tmp/fuze.sock'.
    """

    def __init__(self, socket_path: str = "/tmp/fuze.sock") -> None:
        self._socket_path = socket_path
        self.connected = False

    async def send_step_start(self, run_id: str, step: dict) -> str:
        """Notify daemon of a step starting.

        Args:
            run_id: The run identifier.
            step: Step metadata dict.

        Returns:
            Always 'proceed' in Phase 2.
        """
        return "proceed"

    async def send_step_end(self, run_id: str, step_id: str, metadata: dict) -> None:
        """Notify daemon of a step completing.

        Args:
            run_id: The run identifier.
            step_id: The step identifier.
            metadata: Step result metadata.
        """

    def is_connected(self) -> bool:
        """Whether the client is connected to a daemon.

        Returns:
            Always False in Phase 2.
        """
        return False
