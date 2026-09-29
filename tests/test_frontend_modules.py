"""
Frontend module integrity and script reference tests.
"""
import os
import re
import unittest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class TestFrontendModules(unittest.TestCase):
    EXPECTED_MODULES = [
        'js/modules/storage/indexedDbManager.js',
        'js/modules/sync/syncEngine.js',
        'js/modules/data/hierarchyBuilder.js',
        'js/modules/data/exportService.js',
        'js/modules/ui/summaryCards.js',
        'js/modules/ui/recordsTable.js',
        'js/modules/ui/chartRenderer.js',
        'js/modules/ui/annotationModal.js',
        'js/dataStore.js',
        'js/treeView.js',
        'js/mainPanel.js',
        'js/app.js'
    ]

    def test_all_modules_exist(self):
        for mod in self.EXPECTED_MODULES:
            full_path = os.path.join(PROJECT_ROOT, mod)
            self.assertTrue(os.path.exists(full_path), f"Module {mod} must exist on disk")
            self.assertGreater(os.path.getsize(full_path), 50, f"Module {mod} should not be empty")

    def test_index_html_loads_all_modules_in_order(self):
        index_path = os.path.join(PROJECT_ROOT, 'index.html')
        with open(index_path, 'r', encoding='utf-8') as f:
            html = f.read()

        last_pos = -1
        for mod in self.EXPECTED_MODULES:
            # Match script src="...mod...
            pattern = re.escape(mod) + r'(\?v=[\d\.]+)?'
            match = re.search(pattern, html)
            self.assertIsNotNone(match, f"index.html must include script tag for {mod}")
            pos = match.start()
            self.assertGreater(pos, last_pos, f"Module {mod} should be loaded after previous dependencies")
            last_pos = pos

    def _check_balance(self, file_path):
        with open(file_path, 'r', encoding='utf-8') as f:
            code = f.read()

        i = 0
        n = len(code)
        stack = [] # stores (char, line)
        line = 1
        prev_non_ws = ''

        while i < n:
            c = code[i]
            if c == '\n':
                line += 1
                i += 1
                continue

            if c.isspace():
                i += 1
                continue

            # Multi-line comment: /* ... */
            if c == '/' and i + 1 < n and code[i+1] == '*':
                i += 2
                while i + 1 < n and not (code[i] == '*' and code[i+1] == '/'):
                    if code[i] == '\n':
                        line += 1
                    i += 1
                i += 2
                continue

            # Single-line comment: // ...
            # Note: make sure it's not preceded by a backslash or part of regex
            if c == '/' and i + 1 < n and code[i+1] == '/':
                i += 2
                while i < n and code[i] != '\n':
                    i += 1
                continue

            # Regular expression literal check:
            # A slash is a regex literal if preceded by punctuation/operators or beginning of statement
            if c == '/' and (not prev_non_ws or prev_non_ws in '=(!,?:;[&|{}=+-%*^~'):
                i += 1
                in_char_class = False
                while i < n:
                    if code[i] == '\\':
                        i += 2
                        continue
                    if code[i] == '[':
                        in_char_class = True
                    elif code[i] == ']':
                        in_char_class = False
                    elif code[i] == '/' and not in_char_class:
                        i += 1
                        break
                    if code[i] == '\n':
                        line += 1
                    i += 1
                # consume flags
                while i < n and code[i].isalpha():
                    i += 1
                prev_non_ws = '/'
                continue

            # Single-quoted string
            if c == "'":
                i += 1
                while i < n and code[i] != "'":
                    if code[i] == '\\':
                        i += 1
                    elif code[i] == '\n':
                        line += 1
                    i += 1
                i += 1
                prev_non_ws = "'"
                continue

            # Double-quoted string
            if c == '"':
                i += 1
                while i < n and code[i] != '"':
                    if code[i] == '\\':
                        i += 1
                    elif code[i] == '\n':
                        line += 1
                    i += 1
                i += 1
                prev_non_ws = '"'
                continue

            # Template literal
            if c == '`':
                i += 1
                while i < n and code[i] != '`':
                    if code[i] == '\\':
                        i += 2
                        continue
                    if code[i] == '$' and i + 1 < n and code[i+1] == '{':
                        stack.append(('${', line))
                        i += 2
                        prev_non_ws = '{'
                        break
                    if code[i] == '\n':
                        line += 1
                    i += 1
                else:
                    if i < n and code[i] == '`':
                        i += 1
                    prev_non_ws = '`'
                continue

            # Brackets & parentheses
            if c in '({[':
                stack.append((c, line))
                prev_non_ws = c
            elif c == '}':
                if not stack:
                    return False, f"Unexpected closing brace '}}' at line {line}"
                open_bracket, open_line = stack.pop()
                if open_bracket == '${':
                    # We closed an embedded template expression; resume scanning the template literal
                    while i + 1 < n and code[i+1] != '`':
                        i += 1
                        if code[i] == '\\':
                            i += 1
                            continue
                        if code[i] == '$' and i + 1 < n and code[i+1] == '{':
                            stack.append(('${', line))
                            i += 1
                            break
                        if code[i] == '\n':
                            line += 1
                    else:
                        if i + 1 < n and code[i+1] == '`':
                            i += 1
                elif open_bracket != '{':
                    return False, f"Mismatched bracket: opened '{open_bracket}' at line {open_line}, closed with '}}' at line {line}"
                prev_non_ws = '}'
            elif c == ')':
                if not stack:
                    return False, f"Unexpected closing paren ')' at line {line}"
                open_bracket, open_line = stack.pop()
                if open_bracket != '(':
                    return False, f"Mismatched bracket: opened '{open_bracket}' at line {open_line}, closed with ')' at line {line}"
                prev_non_ws = ')'
            elif c == ']':
                if not stack:
                    return False, f"Unexpected closing bracket ']' at line {line}"
                open_bracket, open_line = stack.pop()
                if open_bracket != '[':
                    return False, f"Mismatched bracket: opened '{open_bracket}' at line {open_line}, closed with ']' at line {line}"
                prev_non_ws = ']'
            else:
                prev_non_ws = c

            i += 1

        if stack:
            open_bracket, open_line = stack[-1]
            return False, f"Unclosed '{open_bracket}' from line {open_line}"

        return True, "OK"

    def test_js_brackets_balance(self):
        for mod in self.EXPECTED_MODULES:
            full_path = os.path.join(PROJECT_ROOT, mod)
            is_valid, msg = self._check_balance(full_path)
            self.assertTrue(is_valid, f"Syntax / bracket error in {mod}: {msg}")

if __name__ == '__main__':
    unittest.main()
