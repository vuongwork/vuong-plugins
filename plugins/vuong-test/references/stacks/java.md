# Java — JUnit 4/5, Mockito, Spring Boot Test (Maven)

## Step 3 — where to look

- Controllers (`@RestController`, `@*Mapping`): method + path, request DTO, `@Valid` constraints, security
  annotations / role checks. Each endpoint is an entry point.
- Services: every `if/switch` on business data, every `throw` (custom exception → error code), loops that
  stop early, `@Transactional` boundaries (what rolls back when a later step fails).
- Exception handlers (`@ControllerAdvice`): exception → HTTP status + error code mapping. Each mapping used
  by the scope is a flow row.
- Repositories / mappers (JPA, MyBatis XML): queries with dynamic conditions — each condition is a branch.
- Batch jobs / schedulers: step order, skip/retry rules, restart behavior.

## Step 6 — naming and layers

```java
// source: <citation from cases.md>
@Test
@DisplayName("[ORD-031] create order with duplicate ref returns ERR-102")
void createDuplicateRef() { ... }
```

JUnit 4 has no `@DisplayName`: put the tag in the method name is not possible (brackets) — use
`@Test public void ORD_031_createDuplicateRef()` and list `ORD_031` as an alias in `cases.md` ID column
(`ORD-031 / ORD_031`) — or migrate the test class to JUnit 5 (spring-boot-starter-test ≥ 2.2 ships it).

- `ut`: service with Mockito mocks (`@ExtendWith(MockitoExtension.class)`), no Spring context — fast.
- `it`: `@SpringBootTest` / `@DataJpaTest` / `@MybatisTest` against a real test DB (Testcontainers when
  available). Use for queries, transactions, mappings.
- `api`: `MockMvc` (`@WebMvcTest`) for controller contract, or Newman against a running server.

## Step 7 — commands (no pom changes needed)

```bash
# sibling modules the tested module depends on (SNAPSHOT, not in any remote repo): install them first
(cd ../<common-module> && mvn -B -q install -DskipTests)

# A) pom has no hard-coded surefire <argLine>:
mvn -B org.jacoco:jacoco-maven-plugin:0.8.11:prepare-agent test org.jacoco:jacoco-maven-plugin:0.8.11:report \
    -Dmaven.test.failure.ignore=true

# B) pom sets <argLine> in surefire config (prepare-agent is silently ignored → no jacoco.exec):
#    attach the agent through the forked JVM's environment instead (needed on older Surefire versions)
A=$(ls ~/.m2/repository/org/jacoco/org.jacoco.agent/0.8.11/org.jacoco.agent-0.8.11-runtime.jar)  # downloaded by run A or `mvn dependency:get -Dartifact=org.jacoco:org.jacoco.agent:0.8.11:jar:runtime`
JAVA_TOOL_OPTIONS="-javaagent:$A=destfile=$PWD/target/jacoco.exec,includes=<base.package>.*" \
  mvn -B test org.jacoco:jacoco-maven-plugin:0.8.11:report -Dmaven.test.failure.ignore=true
# one class / method:  -Dtest=OrderServiceTest  or  -Dtest='OrderServiceTest#createDuplicateRef'
node $PLUGIN/core/collect.mjs --cases W/cases.md --out W/results.json \
  --junit target/surefire-reports --stack java --coverage target/site/jacoco/jacoco.xml --label be
```

Multi-module: run from the parent (or each module) and pass every `*/target/surefire-reports` with its own
`--junit` and every `jacoco.xml` with its own `--coverage ... --label <module>`.

## Pitfalls

- A `<argLine>` set in the pom's surefire config overrides JaCoCo's agent → no `jacoco.exec`, no report.
  `-DargLine=...` on the command line does NOT help (the pom value wins). Use command B above, or ask the
  team to change the pom to `<argLine>@{argLine} <existing args></argLine>` (then command A works).
- `-Dmaven.test.failure.ignore=true` keeps the build going so failed tests still reach the report; the
  failures are in `target/surefire-reports/*.xml`.
- `jacoco.xml` "statements" column shows INSTRUCTION coverage (JaCoCo has no statements metric).
- Tests depending on a shared dev DB are `it`, not `ut`; record their data in the report.
