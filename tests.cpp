#include <cmath>
#include <cstdio>
#include <iostream>
#include <fstream>
#include <limits>
#include <queue>
#include <stdexcept>
#include <string>
#include <vector>

#include "graph/Graph.h"
#include "models/Models.h"
#include "storage/Storage.h"
#include "structures/HashTable.h"
#include "services/RideService.h"

namespace {
void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

void testGraph() {
    Graph graph;
    check(graph.addLocation("A"), "add A");
    check(graph.addLocation("B"), "add B");
    check(graph.addLocation("C"), "add C");
    check(!graph.addLocation("A"), "duplicate location rejected");
    check(graph.addRoad("A", "B", 4.0), "add A-B");
    check(graph.addRoad("B", "C", 3.0), "add B-C");
    check(graph.addRoad("A", "C", 10.0), "add A-C");

    const auto route = graph.shortestPath("A", "C");
    check(route.reachable, "A to C is reachable");
    check(std::abs(route.distance - 7.0) < 1e-9, "Dijkstra distance");
    check(route.path.size() == 3 && route.path.front() == "A" &&
              route.path.back() == "C",
          "Dijkstra route reconstruction");
    check(!graph.shortestPath("A", "missing").reachable, "unknown destination");
    const auto sameLocation = graph.shortestPath("A", "A");
    check(sameLocation.reachable && sameLocation.distance == 0.0 &&
              sameLocation.path.size() == 1 && sameLocation.path.front() == "A",
          "same-location route is a zero-distance singleton");
    Graph tied;
    check(tied.addLocation("S") && tied.addLocation("Z") &&
              tied.addLocation("A") && tied.addLocation("T"),
          "create equal-route graph");
    check(tied.addRoad("S", "Z", 1.0) && tied.addRoad("Z", "T", 1.0) &&
              tied.addRoad("S", "A", 1.0) && tied.addRoad("A", "T", 1.0),
          "create equal-cost alternatives");
    const auto stableTie = tied.shortestPath("S", "T");
    check(stableTie.reachable && stableTie.path.size() == 3 &&
              stableTie.path[1] == "A",
          "equal-distance route uses deterministic lexical predecessor");
    check(!graph.addRoad("A", "missing", 1.0), "unknown road endpoint");
    check(!graph.addRoad("A", "C", -1.0), "negative road rejected");
    check(!graph.addRoad("A", "C", std::numeric_limits<double>::infinity()),
          "infinite road rejected");
    check(!graph.addRoad("A", "C", std::numeric_limits<double>::quiet_NaN()),
          "NaN road rejected");
    check(graph.addRoad("A", "A", 0.0), "zero-length self road accepted");
}

void testHashTable() {
    HashTable<Rider> riders(5);
    const Rider first{"R1", "Test Rider", "0000000000"};
    check(riders.insert(first.id, first), "insert rider");
    check(riders.size() == 1, "hash table size after insert");
    check(riders.find("R1") != nullptr, "find existing rider");
    check(riders.find("R1")->name == "Test Rider", "stored rider value");
    check(riders.find("missing") == nullptr, "missing key returns null");
    check(!riders.insert("", first), "empty key rejected");

    const Rider updated{"R1", "Updated Rider", "1111111111"};
    check(riders.insert(updated.id, updated), "update existing key");
    check(riders.size() == 1, "update does not increase size");
    check(riders.find("R1")->name == "Updated Rider", "updated value");

    HashTable<Rider> tiny(1);
    check(tiny.insert("only", first), "insert into one-slot table");
    check(!tiny.insert("second", updated), "full table rejects new key");
    HashTable<Rider> zeroCapacity(0);
    check(zeroCapacity.insert("one", first), "zero capacity normalizes safely");
}

void testPersistence() {
    HashTable<Rider> savedRiders;
    HashTable<Driver> savedDrivers;
    const Rider rider{"R1", "Test Rider", "demo-phone"};
    const Driver driver{"D1", "Test Driver", "demo-phone", "A", true};
    check(savedRiders.insert(rider.id, rider), "prepare saved rider");
    check(savedDrivers.insert(driver.id, driver), "prepare saved driver");

    std::vector<std::string> riderIds{"R1"};
    std::vector<std::string> driverIds{"D1"};
    std::queue<RideRequest> pending;
    pending.push(RideRequest{7, "R1", "A", "C"});

    Ride ride;
    ride.rideId = 4;
    ride.riderId = "R1";
    ride.driverId = "D1";
    ride.pickup = "A";
    ride.destination = "C";
    ride.distanceKm = 7.0;
    ride.fare = 90.0;
    ride.route = {"A", "B", "C"};
    ride.status = "Completed";
    const std::vector<Ride> history{ride};

    check(storage::save(savedRiders, riderIds, savedDrivers, driverIds,
                        pending, history, 8, 5),
          "save persistence fixture");

    HashTable<Rider> loadedRiders;
    HashTable<Driver> loadedDrivers;
    std::vector<std::string> loadedRiderIds, loadedDriverIds;
    std::queue<RideRequest> loadedPending;
    std::vector<Ride> loadedHistory;
    int nextRequest = 1;
    int nextRide = 1;
    const bool loaded = storage::load(
        loadedRiders, loadedRiderIds, loadedDrivers, loadedDriverIds,
        loadedPending, loadedHistory, nextRequest, nextRide);
    std::remove(storage::fileName());
    std::remove((std::string(storage::fileName()) + ".tmp").c_str());

    check(loaded, "load persistence fixture");
    check(loadedRiders.find("R1") != nullptr, "restored rider exists");
    check(loadedRiders.find("R1")->name == "Test Rider", "restored rider fields");
    check(loadedDrivers.find("D1") != nullptr, "restored driver exists");
    check(loadedDrivers.find("D1")->location == "A", "restored driver fields");
    check(loadedPending.size() == 1 && loadedPending.front().requestId == 7,
          "restored pending request");
    check(loadedHistory.size() == 1 && loadedHistory.front().route.size() == 3,
          "restored ride and route");
    check(nextRequest == 8 && nextRide == 5, "restored ID counters");
    check(loadedRiderIds.size() == 1 && loadedDriverIds.size() == 1,
          "restored record indexes");
}

void testMalformedLoadIsTransactional() {
    {
        std::ofstream out(storage::fileName(), std::ios::trunc);
        check(static_cast<bool>(out), "create malformed persistence fixture");
        out << "SMART_BIKE_TAXI_V1\n"
            << "1 0 0 0 2 1\n"
            << std::quoted("R2") << ' ' << std::quoted("Partial Rider")
            << ' ' << std::quoted("demo") << '\n'
            << "unexpected trailing data\n";
    }

    HashTable<Rider> riders;
    const Rider existing{"KEEP", "Existing", "demo"};
    check(riders.insert(existing.id, existing), "prepare existing state");
    std::vector<std::string> riderIds{"KEEP"}, driverIds;
    HashTable<Driver> drivers;
    std::queue<RideRequest> pending;
    std::vector<Ride> history;
    int nextRequest = 41, nextRide = 42;

    const bool loaded = storage::load(riders, riderIds, drivers, driverIds,
                                      pending, history, nextRequest, nextRide);
    std::remove(storage::fileName());
    std::remove((std::string(storage::fileName()) + ".tmp").c_str());
    std::remove((std::string(storage::fileName()) + ".bak").c_str());

    check(!loaded, "malformed persistence file rejected");
    check(riders.size() == 1 && riders.find("KEEP") != nullptr,
          "failed load preserves existing records");
    check(riders.find("R2") == nullptr, "failed load does not leak partial records");
    check(riderIds.size() == 1 && riderIds.front() == "KEEP",
          "failed load preserves record indexes");
    check(nextRequest == 41 && nextRide == 42,
          "failed load preserves ID counters");
}
void testRideDispatchService() {
    Graph city;
    check(city.addLocation("A") && city.addLocation("B") &&
              city.addLocation("C") && city.addLocation("D"),
          "create dispatch locations");
    check(city.addRoad("A", "B", 2.0) && city.addRoad("B", "C", 3.0) &&
              city.addRoad("D", "A", 1.0),
          "create dispatch roads");

    HashTable<Rider> riders;
    check(riders.insert("R1", Rider{"R1", "Rider One", "demo"}),
          "register dispatch rider");
    HashTable<Driver> drivers;
    check(drivers.insert("FAR", Driver{"FAR", "Far Driver", "demo", "C", true}),
          "register far driver");
    check(drivers.insert("NEAR", Driver{"NEAR", "Near Driver", "demo", "A", true}),
          "register near driver");
    std::vector<std::string> driverIds{"FAR", "NEAR"};
    std::queue<RideRequest> requests;
    requests.push(RideRequest{1, "R1", "A", "C"});
    std::vector<Ride> history;
    int nextRideId = 10;

    const auto result = ride_service::dispatchNext(
        riders, drivers, driverIds, city, requests, history, nextRideId);
    check(result.status == ride_service::DispatchStatus::Dispatched,
          "dispatch succeeds");
    check(result.ride.driverId == "NEAR", "nearest available driver selected");
    check(result.ride.distanceKm == 5.0, "trip distance recorded");
    check(result.ride.fare == 70.0, "fare calculated from trip distance");
    check(result.ride.status == "Assigned", "dispatch creates assigned ride");
    check(requests.empty() && history.size() == 1, "request consumed and ride recorded");
    check(nextRideId == 11, "ride ID increments after dispatch");
    check(drivers.find("NEAR")->location == "A" &&
              !drivers.find("NEAR")->available,
          "assigned driver remains busy at pickup location");
    check(!ride_service::completeRide(history, drivers, 11),
          "cannot complete before ride starts");
    check(!ride_service::cancelRide(history, drivers, 999),
          "cannot cancel a missing ride");
    check(history.front().status == "Cancelled" &&
              drivers.find("NEAR")->available,
          "cancellation records state and releases driver");
    check(!ride_service::startRide(history, 11),
          "cancelled ride cannot start");

    std::queue<RideRequest> secondRequest;
    secondRequest.push(RideRequest{5, "R1", "A", "C"});
    const auto secondDispatch = ride_service::dispatchNext(
        riders, drivers, driverIds, city, secondRequest, history, nextRideId);
    check(secondDispatch.status == ride_service::DispatchStatus::Dispatched,
          "released driver can be assigned to a new ride");
    check(ride_service::startRide(history, 11), "assigned ride starts");
    check(!ride_service::startRide(history, 11), "ride cannot start twice");
    check(ride_service::completeRide(history, drivers, 11),
          "in-progress ride completes");
    check(history.back().status == "Completed", "completed state recorded");
    check(drivers.find("NEAR")->location == "C" &&
              drivers.find("NEAR")->available,
          "completion moves and releases driver");
    check(!ride_service::completeRide(history, drivers, 11),
          "completed ride cannot complete twice");
    check(drivers.find("FAR")->location == "C", "unselected driver unchanged");

    HashTable<Driver> unavailableDrivers;
    check(unavailableDrivers.insert(
              "BUSY", Driver{"BUSY", "Busy Driver", "demo", "A", false}),
          "register busy driver");
    std::vector<std::string> busyIds{"BUSY"};
    std::queue<RideRequest> retained;
    retained.push(RideRequest{2, "R1", "A", "B"});
    std::vector<Ride> noHistory;
    int unchangedRideId = 20;
    const auto noDriver = ride_service::dispatchNext(
        riders, unavailableDrivers, busyIds, city, retained, noHistory,
        unchangedRideId);
    check(noDriver.status == ride_service::DispatchStatus::NoAvailableDriver,
          "busy drivers cannot be dispatched");
    check(retained.size() == 1 && retained.front().requestId == 2,
          "request retained when no driver is available");
    check(noHistory.empty() && unchangedRideId == 20,
          "failed dispatch does not create ride or consume ID");

    std::queue<RideRequest> invalid;
    invalid.push(RideRequest{3, "MISSING", "A", "B"});
    const auto badRequest = ride_service::dispatchNext(
        riders, drivers, driverIds, city, invalid, history, nextRideId);
    check(badRequest.status == ride_service::DispatchStatus::InvalidRequest,
          "unknown rider request rejected");
    check(invalid.size() == 1 && nextRideId == 11,
          "invalid request remains queued without consuming ID");

    std::queue<RideRequest> zeroLength;
    zeroLength.push(RideRequest{4, "R1", "A", "A"});
    const auto sameLocation = ride_service::dispatchNext(
        riders, drivers, driverIds, city, zeroLength, history, nextRideId);
    check(sameLocation.status == ride_service::DispatchStatus::InvalidRequest,
          "identical pickup and destination rejected");
    check(zeroLength.size() == 1 && nextRideId == 11,
          "zero-length request remains queued without consuming ride ID");
}

}  // namespace

int main() {
    try {
        testGraph();
        testHashTable();
        testPersistence();
        testMalformedLoadIsTransactional();
        testRideDispatchService();
        std::cout << "All tests passed.\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Test failure: " << error.what() << '\n';
        return 1;
    }
}
