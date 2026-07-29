from scripts.vick_voice_service import Handler


from http.server import BaseHTTPRequestHandler

from scripts.vick_voice_service import is_client_disconnect


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


def test_handle_one_request_ignores_reset_while_reading_request():
    original = BaseHTTPRequestHandler.handle_one_request

    def raise_disconnect(_handler):
        raise ConnectionResetError(10054, "client closed the local request")

    BaseHTTPRequestHandler.handle_one_request = raise_disconnect
    try:
        object.__new__(Handler).handle_one_request()
    finally:
        BaseHTTPRequestHandler.handle_one_request = original


def test_handle_one_request_does_not_hide_unrelated_socket_errors():
    original = BaseHTTPRequestHandler.handle_one_request

    def raise_unrelated(_handler):
        raise OSError("unexpected socket failure")

    BaseHTTPRequestHandler.handle_one_request = raise_unrelated
    try:
        try:
            object.__new__(Handler).handle_one_request()
        except OSError as error:
            assert "unexpected socket failure" in str(error)
        else:
            raise AssertionError("unrelated OSError must remain visible")
    finally:
        BaseHTTPRequestHandler.handle_one_request = original


def test_send_does_not_hide_unrelated_socket_errors():
    handler = handler_with_writer(DisconnectingWriter(OSError("unexpected socket failure")))
    try:
        handler._send(200, {"ok": True})
    except OSError as error:
        assert "unexpected socket failure" in str(error)
    else:
        raise AssertionError("unrelated OSError must remain visible")


def test_client_disconnect_detection():
    assert is_client_disconnect(BrokenPipeError())
    assert is_client_disconnect(ConnectionAbortedError())
    assert is_client_disconnect(ConnectionResetError())
    assert not is_client_disconnect(OSError("unexpected socket failure"))
