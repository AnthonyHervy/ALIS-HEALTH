from processor.main import should_continue_polling, worker_endpoint


def test_processor_uses_run_next_endpoint():
    assert worker_endpoint("http://api:8000") == "http://api:8000/api/v1/processing/run-next"


def test_processor_can_run_once_or_continuously():
    assert should_continue_polling(loop=False, processed=False) is False
    assert should_continue_polling(loop=True, processed=False) is True
