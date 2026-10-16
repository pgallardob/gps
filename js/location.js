(function (root) {
    "use strict";

    class LocationTracker {
        constructor({ geolocation, secure = true, options = {}, onPosition, onState }) {
            this.geolocation = geolocation;
            this.secure = secure;
            this.options = options;
            this.onPosition = onPosition;
            this.onState = onState;
            this.watchId = null;
            this.generation = 0;
            this.state = "idle";
        }

        setState(state, reason) {
            this.state = state;
            this.onState(state, reason);
        }

        canStart() {
            if (this.state === "tracking" || this.state === "locating") return false;
            if (!this.secure) {
                this.setState("error", "insecure");
                return false;
            }
            if (!this.geolocation) {
                this.setState("error", "unsupported");
                return false;
            }
            return true;
        }

        start() {
            if (!this.canStart()) return;
            const token = ++this.generation;
            this.setState("tracking");
            try {
                const watchId = this.geolocation.watchPosition(
                    position => {
                        if (token === this.generation && this.onPosition(position) === false) this.fail({ code: "invalid" }, token);
                    },
                    error => this.fail(error, token),
                    this.options
                );
                if (token === this.generation) this.watchId = watchId;
                else this.geolocation.clearWatch(watchId);
            } catch (error) {
                this.fail(error, token);
            }
        }

        locate() {
            if (!this.canStart()) return;
            const token = ++this.generation;
            this.setState("locating");
            try {
                this.geolocation.getCurrentPosition(position => {
                    if (token !== this.generation) return;
                    this.generation += 1;
                    if (this.onPosition(position) === false) this.setState("error", "invalid");
                    else this.setState("ready");
                }, error => this.fail(error, token), this.options);
            } catch (error) {
                this.fail(error, token);
            }
        }

        cancel() {
            this.generation += 1;
            if (this.watchId !== null) this.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }

        stop() {
            this.cancel();
            this.setState("paused");
        }

        fail(error, token) {
            if (token !== this.generation) return;
            this.cancel();
            const reasons = { 1: "permission", 2: "unavailable", 3: "timeout", invalid: "invalid" };
            this.setState("error", reasons[error.code] || "unknown");
        }
    }

    if (typeof module === "object" && module.exports) module.exports = LocationTracker;
    else root.LocationTracker = LocationTracker;
})(globalThis);
