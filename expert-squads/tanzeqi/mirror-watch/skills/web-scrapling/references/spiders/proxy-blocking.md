# Blocked-response evidence

In this OpenCorvus package, a blocked response is terminal evidence for the selected request source. Do not rotate proxies, copy and resend the request, change session types, or retry the request.

Scrapling exposes response status and headers that can be inspected to classify the failure. Persist the selected URL, request method, status, relevant response headers, and the caller-visible error. A task that requires another source must name that source as a separate authorized task input before execution; it is not selected after failure.

```python
BLOCKED_STATUS_CODES = {401, 403, 407, 429, 444, 500, 502, 503, 504}

def assert_not_blocked(response):
    if response.status in BLOCKED_STATUS_CODES:
        raise RuntimeError(f"selected source returned blocked status {response.status}")
    return response
```

Set Scrapling request retry counts to zero when the API surface exposes that option. If the selected provider cannot disable retries, that provider is not valid for this package execution.
