import ast, sys
for f in ['app.py', 'session.py']:
    try:
        ast.parse(open(f, encoding='utf-8').read())
        print(f'OK  {f}')
    except SyntaxError as e:
        print(f'ERR {f}: {e}')
sys.exit(0)
