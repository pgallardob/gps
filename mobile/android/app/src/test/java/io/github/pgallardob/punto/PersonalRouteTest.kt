package io.github.pgallardob.punto

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PersonalRouteTest {
    private fun point(lat: Double, elapsed: Long, accuracy: Double = 10.0) = Fix(lat, 0.0, accuracy, elapsed)

    @Test fun personalRouteNeedsNoInvitationAndFiltersNoise() {
        val route = PersonalRoute()
        assertTrue(route.begin())
        assertFalse(route.add(point(0.0, 0, 500.0), 1000))
        assertTrue(route.add(point(0.0, 1000), 1000))
        assertFalse(route.add(point(0.000001, 2000), 2000))
        assertFalse(route.add(point(0.001, 500), 2000))
        assertTrue(route.add(point(0.0001, 6000), 6000))
        assertEquals(2, route.snapshot().count)
        assertTrue(route.snapshot().distanceMeters > 10)
    }

    @Test fun stoppingAndSignalGapsDoNotJoinUnrecordedTravel() {
        val route = PersonalRoute()
        route.begin()
        route.add(point(0.0, 1000), 1000)
        route.stop()
        assertFalse(route.add(point(1.0, 10000), 10000))
        route.begin()
        route.add(point(2.0, 20000), 20000)
        route.add(point(3.0, 60000), 60000)
        val data = route.snapshot()
        assertEquals(3, data.segments.size)
        assertEquals(0.0, data.distanceMeters, 0.001)
    }

    @Test fun stationaryFixesDoNotCreateFakeSignalGaps() {
        val route = PersonalRoute()
        route.begin()
        route.add(point(0.0, 1000), 1000)
        for (elapsed in 6000L..61000L step 5000) assertFalse(route.add(point(0.000001, elapsed), elapsed))
        assertTrue(route.add(point(0.0001, 66000), 66000))
        assertEquals(1, route.snapshot().segments.size)
        assertTrue(route.snapshot().distanceMeters > 10)
    }

    @Test fun pointLimitAndClearCannotSilentlyDiscardAnActiveRoute() {
        val route = PersonalRoute(2)
        route.begin()
        route.add(point(0.0, 1000), 1000)
        route.add(point(0.001, 6000), 6000)
        assertFalse(route.add(point(0.002, 12000), 12000))
        assertEquals(2, route.snapshot().count)
        try { route.clear(); fail("Expected Stop before Clear") } catch (_: IllegalStateException) {}
        route.stop()
        assertFalse(route.begin())
        route.clear()
        assertTrue(route.begin())
        assertEquals(0, route.snapshot().count)
    }

    @Test fun exportContainsOnlyPersonalSegmentsAndUsesGeoJsonLongitudeFirst() {
        val route = PersonalRoute()
        route.begin()
        route.add(Fix(10.0, 20.0, 10.0, 1000), 1000)
        route.add(Fix(10.001, 20.001, 10.0, 6000), 6000)
        route.stop()
        route.begin()
        route.add(Fix(11.0, 21.0, 10.0, 10000), 10000)
        val collection = JSONObject(route.geoJson(true))
        val features = collection.getJSONArray("features")
        assertEquals("FeatureCollection", collection.getString("type"))
        assertEquals(2, features.length())
        val coordinates = features.getJSONObject(0).getJSONObject("geometry").getJSONArray("coordinates").getJSONArray(0)
        assertEquals(20.0, coordinates.getDouble(0), 0.0)
        assertEquals(10.0, coordinates.getDouble(1), 0.0)
        assertEquals("Point", features.getJSONObject(1).getJSONObject("geometry").getString("type"))
        val properties = features.getJSONObject(1).getJSONObject("properties")
        assertEquals("route", properties.getString("kind"))
        assertEquals("demo", properties.getString("source"))
        assertEquals(1, properties.getJSONArray("timestamps").length())
        assertEquals(10.0, properties.getJSONArray("accuracyMeters").getDouble(0), 0.0)
        assertTrue(collection.getJSONObject("metadata").getBoolean("simulated"))
        assertFalse(route.geoJson().contains("token"))
    }

    @Test fun distanceHandlesAntimeridianAndSnapshotsDoNotChangeLater() {
        assertTrue(PersonalRoute.meters(Fix(0.0, 179.999, 1.0, 0), Fix(0.0, -179.999, 1.0, 1)) < 300)
        val route = PersonalRoute()
        route.begin()
        route.add(point(0.0, 1000), 1000)
        val first = route.snapshot()
        route.add(point(0.001, 6000), 6000)
        assertEquals(1, first.segments.single().size)
        assertEquals("RouteSnapshot([redacted])", first.toString())
    }

    @Test fun explicitDashboardClearCanBeginANewSegmentWithoutSilentlyStoppingGps() {
        val route = PersonalRoute()
        route.begin()
        route.add(point(0.0, 1000), 1000)
        route.clear(restartSegment = true)
        assertTrue(route.snapshot().recording)
        assertEquals(0, route.snapshot().count)
        assertTrue(route.add(point(1.0, 6000), 6000))
        assertEquals(0.0, route.snapshot().distanceMeters, 0.0)
    }
}
