def execute_value_node(node_type: str, data: dict, inputs: dict) -> dict:
    if node_type == 'numberValue':
        return {'value': float(data.get('value', 0))}
    elif node_type == 'colorValue':
        return {'value': data.get('value', '#ffffff')}
    return {}
