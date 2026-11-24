import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDiffFile,
  detectRemovedTests,
  sortFilesByReviewCategory,
} from '../../modules/devtools/web/src/utils/gitDiff.ts';

test('classifyDiffFile: Java Maven/Gradle 源码与测试类精准区分', () => {
  assert.equal(
    classifyDiffFile({ path: 'modules/proxy/src/main/java/com/a8/turbo/ProxyHandler.java', is_binary: false }),
    'source'
  );
  // 大小写敏感：Commit.java / Limit.java 结尾是小写 it.java，不得误判为 *IT.java
  assert.equal(
    classifyDiffFile({ path: 'modules/proxy/src/main/java/com/a8/turbo/Commit.java', is_binary: false }),
    'source'
  );
  assert.equal(
    classifyDiffFile({ path: 'modules/proxy/src/main/java/com/a8/turbo/RateLimit.java', is_binary: false }),
    'source'
  );
  // SQL 与 MyBatis XML 归为核心源码
  assert.equal(
    classifyDiffFile({ path: 'modules/proxy/src/main/resources/mapper/OrderMapper.xml', is_binary: false }),
    'source'
  );
  assert.equal(
    classifyDiffFile({ path: 'modules/proxy/src/main/resources/schema.sql', is_binary: false }),
    'source'
  );

  // Java 各类测试路径与命名
  assert.equal(
    classifyDiffFile({ path: 'modules/proxy/src/test/java/com/a8/turbo/ProxyHandlerTest.java', is_binary: false }),
    'test'
  );
  assert.equal(
    classifyDiffFile({ path: 'modules/proxy/src/test/java/com/a8/turbo/ProxyFixture.java', is_binary: false }),
    'test'
  );
  assert.equal(
    classifyDiffFile({ path: 'modules/proxy/src/test/resources/application-test.yml', is_binary: false }),
    'test'
  );
  assert.equal(
    classifyDiffFile({ path: 'custom/OrderCacheIT.java', is_binary: false }),
    'test'
  );
  assert.equal(
    classifyDiffFile({ path: 'custom/TestQueryRewrite.java', is_binary: false }),
    'test'
  );

  // 构建配置、文档与锁文件/产物
  assert.equal(classifyDiffFile({ path: 'modules/proxy/pom.xml', is_binary: false }), 'config_docs');
  assert.equal(
    classifyDiffFile({ path: 'modules/proxy/src/main/resources/application.yml', is_binary: false }),
    'config_docs'
  );
  assert.equal(classifyDiffFile({ path: 'docs/evergreen/platform.md', is_binary: false }), 'config_docs');
  assert.equal(classifyDiffFile({ path: 'modules/ui/web/package-lock.json', is_binary: false }), 'generated');
  assert.equal(classifyDiffFile({ path: 'modules/devtools/ui/assets/index.js', is_binary: false }), 'generated');
  assert.equal(classifyDiffFile({ path: 'modules/ui/web/src/App.test.tsx', is_binary: false }), 'test');
});

test('sortFilesByReviewCategory: 强制按 核心源码 → 测试代码 → 配置文档 → 产物 排序', () => {
  const input = [
    { path: 'Cargo.lock', is_binary: false },
    { path: 'docs/README.md', is_binary: false },
    { path: 'src/test/java/FooTest.java', is_binary: false },
    { path: 'src/main/java/Foo.java', is_binary: false },
  ];
  const sorted = sortFilesByReviewCategory(input).map((f) => f.path);
  assert.deepEqual(sorted, [
    'src/main/java/Foo.java',
    'src/test/java/FooTest.java',
    'docs/README.md',
    'Cargo.lock',
  ]);
});

test('detectRemovedTests: Java JUnit 删除测试、新增 @Disabled 与改签名不误报', () => {
  const diffText = [
    '@@ -10,25 +10,18 @@ class ProxyHandlerTest {',
    '     @Test',
    '-    void shouldKeepModifiedSignature() {',
    '+    void shouldKeepModifiedSignature() throws Exception {',
    '         assertTrue(true);',
    '     }',
    ' ',
    '-    @Test',
    '-    @DisplayName("缓存命中测试")',
    '-    void shouldHitCache() {',
    '-        assertEquals(1, 1);',
    '-    }',
    ' ',
    '+    @Disabled("temporarily skipped")',
    '     @Test',
    '     void shouldEvictExpiredEntry() {',
    '         assertTrue(true);',
    '     }',
    ' ',
    '-    @ParameterizedTest',
    '+    @ParameterizedTest(name = "{0}")',
    '     void shouldHandleTypes(String t) {',
    '         assertNotNull(t);',
    '     }',
    ' }',
  ].join('\n');

  const hits = detectRemovedTests({
    path: 'modules/proxy/src/test/java/com/a8/turbo/ProxyHandlerTest.java',
    old_path: '',
    status: 'M',
    additions: 3,
    deletions: 7,
    is_binary: false,
    truncated: false,
    diff_text: diffText,
  });

  assert.deepEqual(
    hits.map((h) => ({ kind: h.kind, name: h.name })),
    [
      { kind: 'disabled', name: 'shouldEvictExpiredEntry' },
      { kind: 'removed', name: 'shouldHitCache' },
    ]
  );
});

test('detectRemovedTests: JS/TS 删除 it() 与改写 it.skip() 均可捕获且不误伤核心源码', () => {
  const jsTestDiff = [
    '@@ -1,8 +1,4 @@',
    "-it('validates sql types', () => {});",
    "-it('handles timeout', () => {});",
    "+it.skip('handles timeout', () => {});",
    "-test('keeps renamed body', () => { a(); });",
    "+test('keeps renamed body', () => { b(); });",
  ].join('\n');

  const hits = detectRemovedTests({
    path: 'modules/ui/web/src/utils/sql.test.ts',
    old_path: '',
    status: 'M',
    additions: 2,
    deletions: 3,
    is_binary: false,
    truncated: false,
    diff_text: jsTestDiff,
  });

  assert.deepEqual(
    hits.map((h) => ({ kind: h.kind, name: h.name })),
    [
      { kind: 'disabled', name: 'handles timeout' },
      { kind: 'removed', name: 'validates sql types' },
    ]
  );

  // 非测试文件不触发
  const prodHits = detectRemovedTests({
    path: 'modules/ui/web/src/utils/sql.ts',
    old_path: '',
    status: 'M',
    additions: 0,
    deletions: 1,
    is_binary: false,
    truncated: false,
    diff_text: "@@ -1,1 +1,0 @@\n-it('not a test file', () => {});",
  });
  assert.equal(prodHits.length, 0);
});
