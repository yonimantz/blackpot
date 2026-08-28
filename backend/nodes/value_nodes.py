def execute_value_node(node_type: str, data: dict, inputs: dict) -> dict:
    if node_type == 'numberValue':
        return {'value': float(data.get('value', 0))}
    elif node_type == 'colorValue':
        return {'value': data.get('value', '#ffffff')}
    elif node_type == 'math':
        return _execute_math(data, inputs)
    elif node_type == 'boolean':
        return _execute_boolean(data, inputs)
    return {}


def _execute_boolean(data: dict, inputs: dict) -> dict:
    """Switch between input A and input B based on the `enabled` checkbox —
    off (default) selects A, on selects B."""
    selected = 'b' if data.get('enabled') else 'a'
    val = inputs.get(selected)
    if val is None:
        raise ValueError(f"Boolean: Input {selected.upper()} is not connected")

    value_type = data.get('valueType') or 'text'
    if value_type == 'value':
        val = float(val)
    elif value_type in ('text', 'color'):
        val = str(val)

    return {'value': val, 'selected': selected}


def _execute_math(data: dict, inputs: dict) -> dict:
    a = float(inputs.get('a', data.get('a', 0)) or 0)
    b = float(inputs.get('b', data.get('b', 0)) or 0)
    operation = (data.get('operation') or 'add').lower()

    if operation == 'subtract':
        result = a - b
    elif operation == 'multiply':
        result = a * b
    elif operation == 'divide':
        if b == 0:
            return {'error': 'Math: cannot divide by zero'}
        result = a / b
    else:
        result = a + b

    return {'value': result, 'data': {'value': result}}
