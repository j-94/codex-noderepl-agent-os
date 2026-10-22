"""Count plain-text retained-state tokens using an explicitly chosen encoding."""
import json
import sys
import tiktoken

request = json.load(sys.stdin)
encoding = tiktoken.get_encoding(request["encoding"])
print(json.dumps({"tokens": len(encoding.encode(request["text"], disallowed_special=()))}))
