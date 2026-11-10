package io.github.pgallardob.punto

import com.sun.net.httpserver.HttpServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.net.InetSocketAddress
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class ProtocolTest {
    private val id = "r".repeat(22)
    private val token = "t".repeat(43)
    private val publisher = "p".repeat(43)
    private val link get() = "https://pgallardob.github.io/gps/share.html#invite=$id.$token"

    private fun failure(code: String, step: Step, action: () -> Unit) {
        try { action(); fail("Expected a bounded failure") }
        catch (error: ShareFailure) { assertEquals(code, error.code); assertEquals(step, error.step); assertFalse(error.message.orEmpty().contains(token)) }
    }

    @Test fun privateLinksAreStrictAndNeverAcceptAServiceUrlOrOwnerKey() {
        assertEquals(id, Invitation.parse(link).id)
        for (invalid in listOf(link.replace("https:", "http:"), link.replace("pgallardob.github.io", "evil.invalid"),
            link.replace("/gps/", "/other/"), link.replace("#invite", "?private=1#invite"),
            link.replace("https://", "https://user:password@"), link.dropLast(1), token)) {
            failure("invalid_invitation", Step.PREVIEW) { Invitation.parse(invalid) }
        }
    }

    @Test fun privateCapabilitiesAndCoordinatesHaveRedactedRepresentations() {
        assertFalse(Invitation.parse(link).toString().contains(token))
        assertFalse(Acceptance(publisher, 900).toString().contains(publisher))
        assertEquals("Fix([redacted])", Fix(12.345, -67.89, 10.0, 0).toString())
        assertTrue(java.lang.reflect.Modifier.isPrivate(Invitation::class.java.getDeclaredMethod("copy", String::class.java, String::class.java).modifiers))
    }

    @Test fun consentDeadlineCannotBeRenewedAndCancellationIsFinal() {
        var clock = 0L
        val gate = SafetyGate { clock }
        gate.limitTo(60)
        clock = 1000
        gate.limitTo(60)
        assertEquals(59000L, gate.remainingMillis())
        clock = 60000
        failure("expired", Step.STOP) { gate.check() }
        gate.stop()
        failure("stopped", Step.STOP) { gate.check() }
    }

    @Test fun staleFutureAndInvalidPositionsAreRejected() {
        Fix(0.0, 0.0, 10.0, 1000).validate(1000)
        for (fix in listOf(Fix(91.0, 0.0, 1.0, 1000), Fix(0.0, Double.NaN, 1.0, 1000),
            Fix(0.0, 0.0, -1.0, 1000), Fix(0.0, 0.0, 10.0, 2000), Fix(0.0, 0.0, 10.0, -30000))) {
            failure("gps_unavailable", Step.LOCATION) { fix.validate(1000) }
        }
    }

    @Test fun arbitraryNativeRelayTargetsAreNotAllowed() {
        for (url in listOf("http://evil.invalid/relay", "http://127.0.0.1:42/relay", "https://user:password@gps-lj9l.onrender.com")) {
            try { RelayApi(url, false); fail("Expected strict configuration") } catch (_: IllegalArgumentException) {}
        }
    }

    @Test fun realHttpUsesCapabilitiesInHeadersAndAConsentOnlyBody() {
        val calls = mutableListOf<String>()
        withServer { exchange ->
            calls.add(exchange.requestMethod)
            assertEquals(RelayApi.ORIGIN, exchange.requestHeaders.getFirst("Origin"))
            assertNull(exchange.requestHeaders.getFirst("Cookie"))
            val expected = if (exchange.requestMethod == "PUT") publisher else token
            assertEquals("Bearer $expected", exchange.requestHeaders.getFirst("Authorization"))
            val body = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
            val reply = when (exchange.requestMethod) {
                "GET" -> """{"id":"$id","state":"pending","remainingSeconds":900,"expiresAt":"2030-01-01T00:00:00Z"}"""
                "POST" -> {
                    assertEquals(true, JSONObject(body).get("consent"))
                    assertEquals(1, JSONObject(body).length())
                    assertNotNull(exchange.requestHeaders.getFirst("Content-Length"))
                    """{"publisherToken":"$publisher","remainingSeconds":900}"""
                }
                "PUT" -> { assertEquals(3, JSONObject(body).length()); """{"accepted":true}""" }
                else -> """{"stopped":true}"""
            }
            respond(exchange, 200, reply)
        }.use { fixture ->
            val api = RelayApi(fixture.base, true)
            val invitation = Invitation.parse(link)
            assertEquals(900, api.preview(invitation).remainingSeconds)
            val accepted = api.accept(invitation)
            api.publish(invitation, accepted.token, Fix(0.0, 0.0, 10.0, 0))
            api.revoke(invitation, invitation.token)
        }
        assertEquals(listOf("GET", "POST", "PUT", "DELETE"), calls)
    }

    @Test fun redirectsHtmlOversizedResponsesAndUnknownErrorsStaySanitized() {
        for ((status, body, type, expected) in listOf(
            ResponseCase(302, "{}", "application/json", "request_failed"),
            ResponseCase(503, "<h1>Loading</h1>", "text/html", "invalid_response"),
            ResponseCase(200, "x".repeat(17000), "application/json", "invalid_response"),
            ResponseCase(403, """{"error":"private-$token"}""", "application/json", "request_failed")
        )) {
            val calls = AtomicInteger()
            withServer { exchange ->
                calls.incrementAndGet()
                exchange.responseHeaders.add("Location", "/relay/should-not-follow")
                respond(exchange, status, body, type)
            }.use { fixture -> failure(expected, Step.ACCEPT) { RelayApi(fixture.base, true).accept(Invitation.parse(link)) } }
            assertEquals(1, calls.get())
        }
    }

    @Test fun realHttpTimeoutNamesTheAcceptanceStage() {
        withServer { exchange ->
            Thread.sleep(250)
            runCatching { respond(exchange, 200, "{}") }
        }.use { fixture ->
            failure("network_timeout", Step.ACCEPT) { RelayApi(fixture.base, true, 50).accept(Invitation.parse(link)) }
        }
    }

    private data class ResponseCase(val status: Int, val body: String, val type: String, val expected: String)
    private class Fixture(val server: HttpServer, val executor: java.util.concurrent.ExecutorService) : AutoCloseable {
        val base get() = "http://127.0.0.1:${server.address.port}/relay"
        override fun close() { server.stop(0); executor.shutdownNow() }
    }
    private fun withServer(handler: (com.sun.net.httpserver.HttpExchange) -> Unit): Fixture {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val executor = Executors.newCachedThreadPool()
        server.executor = executor
        server.createContext("/relay") { exchange -> handler(exchange) }
        server.start()
        return Fixture(server, executor)
    }
    private fun respond(exchange: com.sun.net.httpserver.HttpExchange, code: Int, body: String, type: String = "application/json") {
        val bytes = body.toByteArray(Charsets.UTF_8)
        exchange.responseHeaders.add("Content-Type", type)
        exchange.sendResponseHeaders(code, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }
}
