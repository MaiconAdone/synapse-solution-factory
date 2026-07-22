from scripts.vick_voice_service import Handler


class DisconnectingWriter:
    def __init__(self, error):
        self.error = error

    def write(self, _body):
        raise self.error


def handler_with_writer(writer):
    handler = object.__new__(Handler)
    handler.headers = {}
    handler.wfile = writer
    handler.send_response = lambda _status: None
    handler.send_header = lambda _name, _value: None
    handler.end_headers = lambda: None
    return handler


def test_send_ignores_normal_client_disconnects():
    for error in (BrokenPipeError(), ConnectionAbortedError(), ConnectionResetError()):
        handler_with_writer(DisconnectingWriter(error))._send(200, {"events": []})


def test_send_does_not_hide_unrelated_socket_errors():
    handler = handler_with_writer(DisconnectingWriter(OSError("unexpected socket failure")))
    try:
        handler._send(200, {"ok": True})
    except OSError as error:
        assert "unexpected socket failure" in str(error)
    else:
        raise AssertionError("unrelated OSError must remain visible")
